import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from '../Application';
import Resources from '../Utils/Resources';
import Sizes from '../Utils/Sizes';
import Camera from '../Camera/Camera';
import EventEmitter from '../Utils/EventEmitter';

const SCREEN_SIZE = { w: 1280, h: 1024 };
const IFRAME_PADDING = 32;
const DIM_FACTOR = 0.7;
const DIM_DISTANCE_SCALE = 10000;
const DIM_PLANE_OFFSET_MARGIN = 5;
const LAYER_OFFSET_SCALE = 4;
/** Centre of the monitor's glass in world units */
const SCREEN_POSITION = new THREE.Vector3(0, 950, 255);
/** Backwards tilt of the monitor around X, in degrees */
const SCREEN_TILT_DEG = -3;
/** Colour of the bezel planes that box in the layered screen */
const BEZEL_COLOR = 0x48493f;
/** Rotation that turns a bezel plane perpendicular to the glass */
const QUARTER_TURN = 90 * THREE.MathUtils.DEG2RAD;
/** Background behind the iframe while it loads (matches the screen tint) */
const SCREEN_BACKGROUND = '#1d2e2f';
/** Screen texture layers, offset = distance from the glass (before scaling) */
const LAYER_CONFIG = {
    smudge: { blending: THREE.AdditiveBlending, opacity: 0.12, offset: 24 },
    innerShadow: { blending: THREE.NormalBlending, opacity: 1, offset: 5 },
    video: { blending: THREE.AdditiveBlending, opacity: 0.5, offset: 10 },
    video2: { blending: THREE.AdditiveBlending, opacity: 0.1, offset: 15 },
};
const MESSAGE_TYPES: MonitorMessageType[] = [
    'mousemove',
    'mousedown',
    'mouseup',
    'keydown',
    'keyup',
];
const IFRAME_SIZE = {
    w: SCREEN_SIZE.w - IFRAME_PADDING,
    h: SCREEN_SIZE.h - IFRAME_PADDING,
};

export default class MonitorScreen extends EventEmitter {
    application: Application;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    resources: Resources;
    sizes: Sizes;
    screenSize: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    camera: Camera;
    prevInComputer: boolean;
    shouldLeaveMonitor: boolean;
    inComputer: boolean;
    mouseClickInProgress: boolean;
    dimmingPlane: THREE.Mesh;
    videoTextures: { [key in string]: THREE.VideoTexture };
    iframe: HTMLIFrameElement;
    iframeOrigin: string;
    cssObject: CSS3DObject | null = null;
    /** Every GL mesh this screen adds to the scene, for dispose() */
    private meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
    private tmpNormal = new THREE.Vector3(0, 0, 1);
    private tmpView = new THREE.Vector3();
    private listeners: {
        target: Window | Document;
        type: string;
        fn: EventListener;
    }[] = [];

    constructor() {
        super();
        this.application = new Application();
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.sizes = this.application.sizes;
        this.resources = this.application.resources;
        this.screenSize = new THREE.Vector2(SCREEN_SIZE.w, SCREEN_SIZE.h);
        this.camera = this.application.camera;
        this.position = SCREEN_POSITION.clone();
        this.rotation = new THREE.Euler(
            SCREEN_TILT_DEG * THREE.MathUtils.DEG2RAD,
            0,
            0,
        );
        this.videoTextures = {};
        this.mouseClickInProgress = false;
        this.shouldLeaveMonitor = false;

        // Create screen
        this.initializeScreenEvents();
        this.createIframe();
        const maxOffset = this.createTextureLayers();
        this.createEnclosingPlanes(maxOffset);
        this.createPerspectiveDimmer(maxOffset);
    }

    private listen(
        target: Window | Document,
        type: string,
        fn: EventListener,
    ) {
        target.addEventListener(type, fn, false);
        this.listeners.push({ target, type, fn });
    }

    initializeScreenEvents() {
        this.listen(
            document,
            'mousemove',
            ((event: MouseEvent & MonitorEventFields) => {
                const id = (event.target as HTMLElement | null)?.id;
                if (id === 'computer-screen') {
                    event.inComputer = true;
                }

                this.inComputer = !!event.inComputer;

                if (this.inComputer && !this.prevInComputer) {
                    this.camera.trigger('enterMonitor');
                }

                if (
                    !this.inComputer &&
                    this.prevInComputer &&
                    !this.mouseClickInProgress
                ) {
                    this.camera.trigger('leftMonitor');
                }

                this.shouldLeaveMonitor =
                    !this.inComputer &&
                    this.mouseClickInProgress &&
                    !!this.prevInComputer;

                this.application.mouse.trigger('mousemove', [event]);

                this.prevInComputer = this.inComputer;
            }) as EventListener,
        );
        this.listen(
            document,
            'mousedown',
            ((event: MouseEvent & MonitorEventFields) => {
                this.inComputer = !!event.inComputer;
                this.application.mouse.trigger('mousedown', [event]);

                this.mouseClickInProgress = true;
                this.prevInComputer = this.inComputer;
            }) as EventListener,
        );
        this.listen(
            document,
            'mouseup',
            ((event: MouseEvent & MonitorEventFields) => {
                this.inComputer = !!event.inComputer;
                this.application.mouse.trigger('mouseup', [event]);

                if (this.shouldLeaveMonitor) {
                    this.camera.trigger('leftMonitor');
                    this.shouldLeaveMonitor = false;
                }

                this.mouseClickInProgress = false;
                this.prevInComputer = this.inComputer;
            }) as EventListener,
        );
        this.listen(window, 'message', ((event: MessageEvent) =>
            this.onMessage(event)) as EventListener);
    }

    private isAllowedOrigin(origin: string) {
        if (origin === window.location.origin) return true;
        if (origin === this.iframeOrigin) return true;
        const dev = new URLSearchParams(window.location.search).has('dev');
        return dev && origin === 'http://localhost:3000';
    }

    private onMessage(event: MessageEvent) {
        if (!this.iframe || !this.isAllowedOrigin(event.origin)) return;
        const data = event.data;
        if (!data || !MESSAGE_TYPES.includes(data.type)) return;

        const evt = new CustomEvent(data.type, {
            bubbles: true,
            cancelable: false,
        }) as CustomEvent & MonitorEventFields;
        evt.inComputer = true;
        if (data.type === 'mousemove') {
            const { top, left, width, height } =
                this.iframe.getBoundingClientRect();
            evt.clientX = Math.round(
                data.clientX * (width / IFRAME_SIZE.w) + left,
            );
            evt.clientY = Math.round(
                data.clientY * (height / IFRAME_SIZE.h) + top,
            );
        } else if (data.type === 'keydown' || data.type === 'keyup') {
            evt.key = data.key;
        }

        this.iframe.dispatchEvent(evt);
    }

    /** Adds a GL mesh to the scene and remembers it for dispose() */
    private addMesh(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>) {
        this.scene.add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    dispose() {
        for (const { target, type, fn } of this.listeners) {
            target.removeEventListener(type, fn, false);
        }
        this.listeners = [];

        for (const mesh of this.meshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.meshes = [];

        for (const texture of Object.values(this.videoTextures)) {
            texture.dispose();
        }
        this.videoTextures = {};

        if (this.cssObject) {
            this.cssScene.remove(this.cssObject);
            this.cssObject.element.remove();
            this.cssObject = null;
        }
    }

    /**
     * Creates the iframe for the computer screen
     */
    createIframe() {
        // Create container
        const container = document.createElement('div');
        container.style.width = this.screenSize.width + 'px';
        container.style.height = this.screenSize.height + 'px';
        container.style.opacity = '1';
        container.style.background = SCREEN_BACKGROUND;

        // Create iframe
        const iframe = document.createElement('iframe');
        this.iframe = iframe;

        // Set iframe attributes
        // PROD
        iframe.src = 'https://os.henryheffernan.com/';
        /**
         * Use dev server is query params are present
         *
         * Warning: This will not work unless the dev server is running on localhost:3000
         * Also running the dev server causes browsers to freak out over unsecure connections
         * in the iframe, so it will flag a ton of issues.
         */
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('dev')) {
            iframe.src = 'http://localhost:3000/';
        }
        try {
            this.iframeOrigin = new URL(
                iframe.src,
                window.location.href,
            ).origin;
        } catch (e) {
            this.iframeOrigin = '';
        }
        iframe.style.width = this.screenSize.width + 'px';
        iframe.style.height = this.screenSize.height + 'px';
        iframe.style.padding = IFRAME_PADDING + 'px';
        iframe.style.boxSizing = 'border-box';
        iframe.style.opacity = '1';
        iframe.className = 'jitter';
        iframe.id = 'computer-screen';
        iframe.frameBorder = '0';
        iframe.title = 'HeffernanOS';

        // Add iframe to container
        container.appendChild(iframe);

        // Create CSS plane
        this.createCssPlane(container);
    }

    /**
     * Creates a CSS plane and GL plane to properly occlude the CSS plane
     * @param element the element to create the css plane for
     */
    createCssPlane(element: HTMLElement) {
        // Create CSS3D object
        const object = new CSS3DObject(element);

        // copy monitor position and rotation
        object.position.copy(this.position);
        object.rotation.copy(this.rotation);

        // Add to CSS scene
        this.cssScene.add(object);
        this.cssObject = object;

        // Create GL plane. NoBlending writes the fragment as-is, punching a
        // hole in the WebGL canvas so the CSS iframe behind it shows through
        // and is occluded by anything drawn in front. The colour MUST be
        // black: the canvas is premultiplied-alpha, so rgba(1,1,1,0) would be
        // composited as additive white over the iframe (white monitor).
        const material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            opacity: 0,
            transparent: true,
            blending: THREE.NoBlending,
            side: THREE.DoubleSide,
        });

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height,
        );

        // Create the GL plane mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy the position, rotation and scale of the CSS plane to the GL plane
        mesh.position.copy(object.position);
        mesh.rotation.copy(object.rotation);
        mesh.scale.copy(object.scale);

        // Add to gl scene
        this.addMesh(mesh);
    }

    /**
     * Creates the texture layers for the computer screen
     * @returns the maximum offset of the texture layers
     */
    createTextureLayers() {
        const textures = this.resources.items.texture;

        this.getVideoTextures('video-1');
        this.getVideoTextures('video-2');

        const scaleFactor = LAYER_OFFSET_SCALE;

        // Construct the texture layers
        const layers: {
            texture: THREE.Texture | undefined;
            blending: THREE.Blending;
            opacity: number;
            offset: number;
        }[] = [
            { ...LAYER_CONFIG.smudge, texture: textures.monitorSmudgeTexture },
            {
                ...LAYER_CONFIG.innerShadow,
                texture: textures.monitorShadowTexture,
            },
            { ...LAYER_CONFIG.video, texture: this.videoTextures['video-1'] },
            { ...LAYER_CONFIG.video2, texture: this.videoTextures['video-2'] },
        ];

        // Declare max offset
        let maxOffset = -1;

        // Add the texture layers to the screen
        for (const layer of layers) {
            if (!layer.texture) continue;
            const offset = layer.offset * scaleFactor;
            this.addTextureLayer(
                layer.texture,
                layer.blending,
                layer.opacity,
                offset,
            );
            // Calculate the max offset
            if (offset > maxOffset) maxOffset = offset;
        }

        // Return the max offset
        return maxOffset;
    }

    getVideoTextures(videoId: string) {
        const video = document.getElementById(videoId);
        if (video instanceof HTMLVideoElement) {
            // Keeps three's default LinearEncoding/LinearFilter on purpose to preserve the original additive static look.
            this.videoTextures[videoId] = new THREE.VideoTexture(video);
        }
    }

    /** Plays or pauses the videos behind this screen's video textures. */
    setVideosPlaying(playing: boolean) {
        for (const texture of Object.values(this.videoTextures)) {
            const video = texture.image;
            if (!(video instanceof HTMLVideoElement)) continue;
            if (playing) {
                const p = video.play();
                if (p) p.catch(() => {});
            } else {
                video.pause();
            }
        }
    }

    /**
     * Adds a texture layer to the screen
     * @param texture the texture to add
     * @param blending the blending mode
     * @param opacity the opacity of the texture
     * @param offset the offset of the texture, higher values are further from the screen
     */
    addTextureLayer(
        texture: THREE.Texture,
        blendingMode: THREE.Blending,
        opacity: number,
        offset: number,
    ) {
        // Create material
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            blending: blendingMode,
            side: THREE.DoubleSide,
            opacity,
            transparent: true,
        });

        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height,
        );

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy position and apply the depth offset
        mesh.position.copy(
            this.offsetPosition(this.position, new THREE.Vector3(0, 0, offset)),
        );

        // Copy rotation
        mesh.rotation.copy(this.rotation);

        this.addMesh(mesh);
    }

    /**
     * Creates enclosing planes for the computer screen
     * @param maxOffset the maximum offset of the texture layers
     */
    createEnclosingPlanes(maxOffset: number) {
        // Four bezel planes boxing in the layered screen, maxOffset deep
        const planes = {
            left: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        -this.screenSize.width / 2,
                        0,
                        maxOffset / 2,
                    ),
                ),
                rotation: new THREE.Euler(0, QUARTER_TURN, 0),
            },
            right: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        this.screenSize.width / 2,
                        0,
                        maxOffset / 2,
                    ),
                ),
                rotation: new THREE.Euler(0, QUARTER_TURN, 0),
            },
            top: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        this.screenSize.height / 2,
                        maxOffset / 2,
                    ),
                ),
                rotation: new THREE.Euler(QUARTER_TURN, 0, 0),
            },
            bottom: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        -this.screenSize.height / 2,
                        maxOffset / 2,
                    ),
                ),
                rotation: new THREE.Euler(QUARTER_TURN, 0, 0),
            },
        };

        // Add each of the planes
        for (const plane of Object.values(planes)) {
            this.createEnclosingPlane(plane);
        }
    }

    /**
     * Creates a plane for the enclosing planes
     * @param plane the plane to create
     */
    createEnclosingPlane(plane: EnclosingPlane) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: BEZEL_COLOR,
        });

        const geometry = new THREE.PlaneGeometry(plane.size.x, plane.size.y);
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.copy(plane.position);
        mesh.rotation.copy(plane.rotation);

        this.addMesh(mesh);
    }

    createPerspectiveDimmer(maxOffset: number) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x000000,
            transparent: true,
            blending: THREE.AdditiveBlending,
        });

        const plane = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height,
        );

        const mesh = new THREE.Mesh(plane, material);

        mesh.position.copy(
            this.offsetPosition(
                this.position,
                new THREE.Vector3(0, 0, maxOffset - DIM_PLANE_OFFSET_MARGIN),
            ),
        );

        mesh.rotation.copy(this.rotation);

        this.dimmingPlane = mesh;

        this.addMesh(mesh);
    }

    /**
     * Offsets a position vector by another vector
     * @param position the position to offset
     * @param offset the offset to apply
     * @returns the new offset position
     */
    offsetPosition(position: THREE.Vector3, offset: THREE.Vector3) {
        const newPosition = new THREE.Vector3();
        newPosition.copy(position);
        newPosition.add(offset);
        return newPosition;
    }

    update() {
        if (!this.dimmingPlane) return;

        const camPos = this.camera.instance.position;
        const view = this.tmpView.copy(camPos).sub(this.position).normalize();
        const dot = view.dot(this.tmpNormal);

        // distance from the camera to the dimming plane
        const distance = camPos.distanceTo(this.dimmingPlane.position);
        const opacity = 1 / (distance / DIM_DISTANCE_SCALE);

        (this.dimmingPlane.material as THREE.MeshBasicMaterial).opacity =
            (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
    }
}
