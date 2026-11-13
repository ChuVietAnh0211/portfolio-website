import * as THREE from 'three';
import Application from '../Application';
import Sizes from '../Utils/Sizes';
import EventEmitter from '../Utils/EventEmitter';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import TWEEN, { Tween } from '@tweenjs/tween.js';
import Renderer from '../Renderer';
import UIEventBus from '../UI/EventBus';
import Time from '../Utils/Time';
import BezierEasing from 'bezier-easing';
import {
    CameraKeyframeInstance,
    MonitorKeyframe,
    IdleKeyframe,
    LoadingKeyframe,
    DeskKeyframe,
    OrbitControlsStart,
    motionPreference,
} from './CameraKeyframes';

/** Longest camera transition allowed when the user prefers reduced motion. */
const REDUCED_MOTION_MAX_TRANSITION_MS = 300;
/** Mouse events within this window after a touch are treated as touch-generated. */
const TOUCH_MOUSE_EMULATION_MS = 800;
/** Elements whose default mousedown behaviour (focus, selection) must be kept. */
const INTERACTIVE_SELECTOR =
    'input, textarea, select, button, a[href], label, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Camera frustum, derived from scene scale (desk ~ thousands of units, loading keyframe ~64k away). */
const CAMERA_FOV = 35;
const CAMERA_NEAR = 50;
const CAMERA_FAR = 300000;

export enum CameraKey {
    IDLE = 'idle',
    MONITOR = 'monitor',
    LOADING = 'loading',
    DESK = 'desk',
    ORBIT_CONTROLS_START = 'orbitControlsStart',
}
export default class Camera extends EventEmitter {
    application: Application;
    sizes: Sizes;
    scene: THREE.Scene;
    instance: THREE.PerspectiveCamera;
    /** Set in createControls(), once the Renderer exists. */
    renderer?: Renderer;
    time: Time;

    position: THREE.Vector3;
    focalPoint: THREE.Vector3;

    freeCam: boolean;
    orbitControls: OrbitControls;

    currentKeyframe: CameraKey | undefined;
    targetKeyframe: CameraKey | undefined;
    keyframes: { [key in CameraKey]: CameraKeyframeInstance };

    private activeTweens: Tween<THREE.Vector3>[];
    private lastTouchTime: number;
    private onTouchStart: () => void;
    private onMouseDown: (event: MouseEvent) => void;
    private onKeyDown: (event: KeyboardEvent) => void;
    private onFreeCamToggle: (toggle: boolean) => void;
    private onLoadingScreenDone: () => void;

    constructor() {
        super();
        this.application = new Application();
        this.sizes = this.application.sizes;
        this.scene = this.application.scene;
        this.time = this.application.time;

        this.position = new THREE.Vector3(0, 0, 0);
        this.focalPoint = new THREE.Vector3(0, 0, 0);

        this.freeCam = false;
        this.activeTweens = [];
        this.lastTouchTime = -Infinity;

        this.keyframes = {
            idle: new IdleKeyframe(),
            monitor: new MonitorKeyframe(),
            loading: new LoadingKeyframe(),
            desk: new DeskKeyframe(),
            orbitControlsStart: new OrbitControlsStart(),
        };

        this.onTouchStart = () => {
            this.lastTouchTime = performance.now();
        };
        document.addEventListener('touchstart', this.onTouchStart, {
            passive: true,
            capture: true,
        });

        this.onMouseDown = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const touchGenerated =
                performance.now() - this.lastTouchTime <
                TOUCH_MOUSE_EMULATION_MS;
            const interactive = !!target?.closest(INTERACTIVE_SELECTOR);
            // Prevent text selection / focus stealing on the canvas only;
            // keep native behaviour for touch and interactive UI elements.
            if (!touchGenerated && !interactive) event.preventDefault();

            if (target && target.id === 'prevent-click') return;
            if (this.isAt(CameraKey.IDLE)) {
                this.transition(CameraKey.DESK);
            } else if (this.isAt(CameraKey.DESK)) {
                this.transition(CameraKey.IDLE);
            }
        };
        document.addEventListener('mousedown', this.onMouseDown);

        this.setPostLoadTransition();
        this.setInstance();
        this.setMonitorListeners();
        this.setFreeCamListeners();
        this.setKeyboardListeners();
    }

    private isAt(key: CameraKey) {
        return this.currentKeyframe === key || this.targetKeyframe === key;
    }

    private stopTweens() {
        for (const tween of this.activeTweens) tween.stop();
        this.activeTweens = [];
    }

    private setWebglPointerEvents(value: 'auto' | 'none') {
        const webgl = document.getElementById('webgl');
        if (webgl) webgl.style.pointerEvents = value;
    }

    transition(
        key: CameraKey,
        duration: number = 1000,
        easing?: (amount: number) => number,
        callback?: () => void
    ) {
        if (this.currentKeyframe === key) return;

        this.stopTweens();

        if (motionPreference.reduced) {
            duration = Math.min(duration, REDUCED_MOTION_MAX_TRANSITION_MS);
        }

        this.currentKeyframe = undefined;
        this.targetKeyframe = key;

        const keyframe = this.keyframes[key];

        const posTween = new TWEEN.Tween(this.position)
            .to(keyframe.position, duration)
            .easing(easing || TWEEN.Easing.Quintic.InOut)
            .onComplete(() => {
                this.activeTweens = [];
                this.currentKeyframe = key;
                this.targetKeyframe = undefined;
                if (callback) callback();
            });

        const focTween = new TWEEN.Tween(this.focalPoint)
            .to(keyframe.focalPoint, duration)
            .easing(easing || TWEEN.Easing.Quintic.InOut);

        this.activeTweens = [posTween, focTween];
        posTween.start();
        focTween.start();
    }

    setInstance() {
        this.instance = new THREE.PerspectiveCamera(
            CAMERA_FOV,
            this.sizes.width / this.sizes.height,
            CAMERA_NEAR,
            CAMERA_FAR
        );
        this.currentKeyframe = CameraKey.LOADING;

        this.scene.add(this.instance);
    }

    setMonitorListeners() {
        this.on('enterMonitor', () => {
            this.transition(
                CameraKey.MONITOR,
                2000,
                BezierEasing(0.13, 0.99, 0, 1)
            );
            UIEventBus.dispatch('enterMonitor', {});
        });
        this.on('leftMonitor', () => {
            this.transition(CameraKey.DESK);
            UIEventBus.dispatch('leftMonitor', {});
        });
    }

    setFreeCamListeners() {
        this.onFreeCamToggle = (toggle: boolean) => {
            if (toggle) {
                this.transition(
                    CameraKey.ORBIT_CONTROLS_START,
                    750,
                    BezierEasing(0.13, 0.99, 0, 1),
                    () => {
                        this.instance.position.copy(
                            this.keyframes.orbitControlsStart.position
                        );

                        this.orbitControls.update();
                        this.orbitControls.enabled = true;
                        this.freeCam = true;
                    }
                );
                this.setWebglPointerEvents('auto');
            } else {
                this.freeCam = false;
                if (this.orbitControls) this.orbitControls.enabled = false;
                this.transition(
                    CameraKey.IDLE,
                    4000,
                    TWEEN.Easing.Exponential.Out
                );
                this.setWebglPointerEvents('none');
            }
        };
        UIEventBus.on('freeCamToggle', this.onFreeCamToggle);
    }

    setKeyboardListeners() {
        this.onKeyDown = (event: KeyboardEvent) => {
            // Only native key presses on the page; keys forwarded from the
            // monitor iframe arrive as CustomEvents and belong to the OS.
            if (!(event instanceof KeyboardEvent)) return;
            if (event.key !== 'Escape' || this.freeCam) return;

            if (this.isAt(CameraKey.MONITOR)) {
                this.trigger('leftMonitor');
            } else if (this.isAt(CameraKey.DESK)) {
                this.transition(CameraKey.IDLE);
            }
        };
        document.addEventListener('keydown', this.onKeyDown);
    }

    dispose() {
        document.removeEventListener('touchstart', this.onTouchStart, true);
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('keydown', this.onKeyDown);
        UIEventBus.remove('freeCamToggle', this.onFreeCamToggle);
        UIEventBus.remove('loadingScreenDone', this.onLoadingScreenDone);
        this.off('enterMonitor');
        this.off('leftMonitor');
        this.stopTweens();
        if (this.orbitControls) this.orbitControls.dispose();
    }

    setPostLoadTransition() {
        this.onLoadingScreenDone = () => {
            this.transition(CameraKey.IDLE, 2500, TWEEN.Easing.Exponential.Out);
        };
        UIEventBus.on('loadingScreenDone', this.onLoadingScreenDone);
    }

    resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height;
        this.instance.updateProjectionMatrix();
    }

    createControls() {
        const renderer = this.application.renderer;
        this.renderer = renderer;
        this.orbitControls = new OrbitControls(
            this.instance,
            renderer.instance.domElement
        );

        const { x, y, z } = this.keyframes.orbitControlsStart.focalPoint;
        this.orbitControls.target.set(x, y, z);

        this.orbitControls.enabled = false;
        this.orbitControls.enablePan = false;
        this.orbitControls.enableDamping = true;
        this.orbitControls.object.position.copy(
            this.keyframes.orbitControlsStart.position
        );
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.maxPolarAngle = Math.PI / 2;
        this.orbitControls.minDistance = 4000;
        this.orbitControls.maxDistance = 29000;

        this.orbitControls.update();
    }

    update() {
        TWEEN.update();

        if (this.freeCam && this.orbitControls) {
            this.position.copy(this.orbitControls.object.position);
            this.focalPoint.copy(this.orbitControls.target);
            this.orbitControls.update();
            return;
        }

        for (const key in this.keyframes) {
            const _key = key as CameraKey;
            this.keyframes[_key].update();
        }

        if (this.currentKeyframe) {
            const keyframe = this.keyframes[this.currentKeyframe];
            this.position.copy(keyframe.position);
            this.focalPoint.copy(keyframe.focalPoint);
        }

        this.instance.position.copy(this.position);
        this.instance.lookAt(this.focalPoint);
    }
}
