import * as THREE from 'three';
import { CameraKey } from './Camera';
import Time from '../Utils/Time';
import Application from '../Application';
import Mouse from '../Utils/Mouse';
import Sizes from '../Utils/Sizes';

/**
 * Reduced-motion preference, shared by the camera and its keyframes.
 * When true: no idle sway, no pointer parallax, short transitions.
 */
const reducedMotionQuery: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

export const motionPreference = {
    reduced: !!reducedMotionQuery?.matches,
};

if (reducedMotionQuery) {
    const onChange = (event: MediaQueryListEvent) => {
        motionPreference.reduced = event.matches;
    };
    // Safari < 14 only supports addListener
    if (typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener('change', onChange);
    } else {
        reducedMotionQuery.addListener(onChange);
    }
}

/** Frame-rate independent damping factor; equals `perFrameAt60` at 60 fps. */
const FRAME_MS_60 = 1000 / 60;
const MAX_DAMPING_DT_MS = 100; // avoid jumps after a stalled / hidden tab
function damping(perFrameAt60: number, deltaMs: number): number {
    const k = -Math.log(1 - perFrameAt60) / FRAME_MS_60;
    const dt = Math.min(Math.max(deltaMs, 0), MAX_DAMPING_DT_MS);
    return 1 - Math.exp(-k * dt);
}

/**
 * 0 for landscape / square viewports, ramping to 1 for phone-portrait
 * (height / width >= PORTRAIT_FULL_ASPECT). Used to blend portrait framing.
 */
const PORTRAIT_FULL_ASPECT = 2.0;
function portraitAmount(sizes: Sizes): number {
    const aspect = sizes.height / sizes.width;
    return THREE.MathUtils.clamp(
        (aspect - 1) / (PORTRAIT_FULL_ASPECT - 1),
        0,
        1
    );
}

export class CameraKeyframeInstance {
    position: THREE.Vector3;
    focalPoint: THREE.Vector3;

    constructor(keyframe: CameraKeyframe) {
        this.position = keyframe.position;
        this.focalPoint = keyframe.focalPoint;
    }

    update() {}
}

const keys: { [key in CameraKey]: CameraKeyframe } = {
    idle: {
        position: new THREE.Vector3(-20000, 12000, 20000),
        focalPoint: new THREE.Vector3(0, -1000, 0),
    },
    monitor: {
        position: new THREE.Vector3(0, 950, 2000),
        focalPoint: new THREE.Vector3(0, 950, 0),
    },
    desk: {
        position: new THREE.Vector3(0, 1800, 5500),
        focalPoint: new THREE.Vector3(0, 500, 0),
    },
    loading: {
        position: new THREE.Vector3(-35000, 35000, 35000),
        focalPoint: new THREE.Vector3(0, -5000, 0),
    },
    orbitControlsStart: {
        position: new THREE.Vector3(-15000, 10000, 15000),
        focalPoint: new THREE.Vector3(-100, 350, 0),
    },
};

/** Monitor keyframe: pull back with viewport aspect so the screen fits. */
const MONITOR_PULLBACK_PER_ASPECT = 1200;
const MONITOR_LANDSCAPE_ZOOM = 600; // extra push-in on landscape viewports

export class MonitorKeyframe extends CameraKeyframeInstance {
    application: Application;
    sizes: Sizes;
    targetPos: THREE.Vector3;
    origin: THREE.Vector3;

    constructor() {
        const keyframe = keys.monitor;
        super(keyframe);
        this.application = new Application();
        this.sizes = this.application.sizes;
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.targetPos = new THREE.Vector3().copy(keyframe.position);
    }

    update() {
        const aspect = this.sizes.height / this.sizes.width;
        const additionalZoom =
            MONITOR_LANDSCAPE_ZOOM * (1 - portraitAmount(this.sizes));
        this.targetPos.z =
            this.origin.z + aspect * MONITOR_PULLBACK_PER_ASPECT - additionalZoom;
        this.position.copy(this.targetPos);
    }
}

export class LoadingKeyframe extends CameraKeyframeInstance {
    constructor() {
        const keyframe = keys.loading;
        super(keyframe);
    }
}

/**
 * Desk keyframe pointer parallax, in world units per unit of normalized
 * pointer (nx, ny in [-1, 1], ny positive downwards). Calibrated so a
 * 1440x900 viewport produces exactly the previous pixel-based targets:
 *   focal.x = pos.x = mouse.x - width / 2   ->  720 * nx
 *   focal.y = height - mouse.y              ->  450 - 450 * ny
 *   pos.y   = 2 * height - mouse.y          -> 1350 - 450 * ny
 */
const DESK_PARALLAX_X = 720;
const DESK_PARALLAX_Y = 450;
const DESK_FOCAL_Y_BASE = 450;
const DESK_POS_Y_BASE = 1350;
const DESK_FOCAL_DAMPING_60FPS = 0.05;
const DESK_POS_DAMPING_60FPS = 0.025;
/** Pull back with viewport aspect (h/w) so the desk fits narrower screens. */
const DESK_PULLBACK_PER_ASPECT = 3000;
const DESK_PULLBACK_OFFSET = -1800;

/**
 * Portrait framing (blended in by portraitAmount): the plain aspect pull-back
 * leaves a tiny monitor and lets the chair fill the lower third, so on tall
 * viewports the camera comes closer, sits higher and looks down onto the
 * monitor + keyboard, with a smaller horizontal parallax swing.
 */
export const DESK_PORTRAIT = {
    pullbackReduction: 2400,
    posRaiseY: 1300,
    focalRaiseY: -150,
    parallaxXScale: 0.35,
    parallaxYScale: 0.5,
};

export class DeskKeyframe extends CameraKeyframeInstance {
    origin: THREE.Vector3;
    application: Application;
    mouse: Mouse;
    sizes: Sizes;
    time: Time;
    targetFoc: THREE.Vector3;
    targetPos: THREE.Vector3;

    constructor() {
        const keyframe = keys.desk;
        super(keyframe);
        this.application = new Application();
        this.mouse = this.application.mouse;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.targetFoc = new THREE.Vector3().copy(keyframe.focalPoint);
        this.targetPos = new THREE.Vector3().copy(keyframe.position);
    }

    update() {
        const { width, height } = this.sizes;
        const portrait = portraitAmount(this.sizes);

        let nx = 0;
        let ny = 0;
        if (!motionPreference.reduced) {
            nx = THREE.MathUtils.clamp((this.mouse.x / width) * 2 - 1, -1, 1);
            ny = THREE.MathUtils.clamp((this.mouse.y / height) * 2 - 1, -1, 1);
        }

        const rangeX =
            DESK_PARALLAX_X *
            THREE.MathUtils.lerp(1, DESK_PORTRAIT.parallaxXScale, portrait);
        const rangeY =
            DESK_PARALLAX_Y *
            THREE.MathUtils.lerp(1, DESK_PORTRAIT.parallaxYScale, portrait);

        const focX = nx * rangeX;
        const focY =
            DESK_FOCAL_Y_BASE +
            portrait * DESK_PORTRAIT.focalRaiseY -
            ny * rangeY;
        const posX = nx * rangeX;
        const posY =
            DESK_POS_Y_BASE + portrait * DESK_PORTRAIT.posRaiseY - ny * rangeY;

        if (motionPreference.reduced) {
            this.targetFoc.x = focX;
            this.targetFoc.y = focY;
            this.targetPos.x = posX;
            this.targetPos.y = posY;
        } else {
            const delta = this.time.delta;
            const focAlpha = damping(DESK_FOCAL_DAMPING_60FPS, delta);
            const posAlpha = damping(DESK_POS_DAMPING_60FPS, delta);
            this.targetFoc.x += (focX - this.targetFoc.x) * focAlpha;
            this.targetFoc.y += (focY - this.targetFoc.y) * focAlpha;
            this.targetPos.x += (posX - this.targetPos.x) * posAlpha;
            this.targetPos.y += (posY - this.targetPos.y) * posAlpha;
        }

        const aspect = height / width;
        this.targetPos.z =
            this.origin.z +
            aspect * DESK_PULLBACK_PER_ASPECT +
            DESK_PULLBACK_OFFSET -
            portrait * DESK_PORTRAIT.pullbackReduction;

        this.focalPoint.copy(this.targetFoc);
        this.position.copy(this.targetPos);
    }
}

/** Idle keyframe: slow orbit-like sway around the desk. */
const IDLE_SWAY_X_FREQ = 0.00008; // rad per ms
const IDLE_SWAY_X_PHASE_MS = 19000;
const IDLE_SWAY_Y_FREQ = 0.000004; // rad per ms
const IDLE_SWAY_Y_PHASE_MS = 1000;
const IDLE_SWAY_Y_AMPLITUDE = 4000;
const IDLE_SWAY_Y_OFFSET = -3000;

export class IdleKeyframe extends CameraKeyframeInstance {
    time: Time;
    origin: THREE.Vector3;

    constructor() {
        const keyframe = keys.idle;
        super(keyframe);
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.time = new Application().time;
    }

    update() {
        // With reduced motion the camera rests at the sway's start pose.
        const elapsed = motionPreference.reduced ? 0 : this.time.elapsed;
        this.position.x =
            Math.sin((elapsed + IDLE_SWAY_X_PHASE_MS) * IDLE_SWAY_X_FREQ) *
            this.origin.x;
        this.position.y =
            Math.sin((elapsed + IDLE_SWAY_Y_PHASE_MS) * IDLE_SWAY_Y_FREQ) *
                IDLE_SWAY_Y_AMPLITUDE +
            this.origin.y +
            IDLE_SWAY_Y_OFFSET;
    }
}

export class OrbitControlsStart extends CameraKeyframeInstance {
    constructor() {
        const keyframe = keys.orbitControlsStart;
        super(keyframe);
    }
}
