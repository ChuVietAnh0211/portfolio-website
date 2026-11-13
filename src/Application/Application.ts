import * as THREE from 'three';

import Debug from './Utils/Debug';
import Sizes from './Utils/Sizes';
import Time from './Utils/Time';
import Camera from './Camera/Camera';
import Renderer from './Renderer';
import Mouse from './Utils/Mouse';

import World from './World/World';
import Resources from './Utils/Resources';

import sources from './sources';

import type Stats from 'stats.js';
import Loading from './Utils/Loading';

import UI from './UI';

let instance: Application | null = null;

export default class Application {
    debug: Debug;
    sizes: Sizes;
    time: Time;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    overlayScene: THREE.Scene;
    /**
     * Left unset when WebGL is unavailable (the constructor returns before
     * creating it, so no assets are downloaded). Typed as definite because
     * scene objects (BakedObject, CoffeeSteam, AudioManager) read it, and they
     * are only ever constructed by World, after it exists.
     */
    resources: Resources;
    camera: Camera;
    /**
     * Left unset when WebGL is unavailable. Typed as definite because
     * BakedModel reads `renderer.instance`, and it only runs after the
     * renderer was created; Application itself guards with `?.`/checks.
     */
    renderer: Renderer;
    world?: World;
    mouse: Mouse;
    loading: Loading;
    ui: UI;
    stats: Stats | undefined;

    constructor() {
        // Singleton
        if (instance) {
            return instance;
        }

        instance = this;

        // Setup
        this.debug = new Debug();
        this.sizes = new Sizes();
        this.mouse = new Mouse();
        this.loading = new Loading();
        this.time = new Time();
        this.scene = new THREE.Scene();
        this.cssScene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.camera = new Camera();

        // Mount the React UI first so its loading / WebGL-error screen shows
        // even if the 3D layer cannot start.
        this.ui = new UI();

        try {
            this.renderer = new Renderer();
        } catch (error) {
            console.warn('WebGL unavailable, 3D scene disabled.', error);
            // Permanent stop: a later visibilitychange must not restart it
            this.time.destroy();
            return;
        }

        // Only download assets once we know they can be rendered
        this.resources = new Resources(sources);
        this.camera.createControls();
        this.world = new World();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('debug')) this.loadStats();

        // Resize event
        this.sizes.on('resize', () => {
            this.resize();
        });

        // Time tick event
        this.time.on('tick', () => {
            this.update();
        });
    }

    /** stats.js is only fetched when ?debug is present */
    private async loadStats() {
        try {
            const { default: StatsCtor } = await import('stats.js');
            this.stats = new StatsCtor();
            this.stats.showPanel(0);
            document.body.appendChild(this.stats.dom);
        } catch (error) {
            console.warn('Failed to load stats.js', error);
        }
    }

    resize() {
        if (!this.renderer) return;
        this.camera.resize();
        this.renderer.resize();
    }

    update() {
        if (!this.renderer || !this.world) return;
        this.stats?.begin();
        this.camera.update();
        this.world.update();
        this.renderer.update();
        this.stats?.end();
    }

    destroy() {
        this.time.off('tick');
        this.sizes.off('resize');
        this.camera.dispose();
        this.mouse.destroy();
        // Traverse the whole scene (before World removes the baked groups)
        this.scene.traverse((child) => {
            // Test if it's a mesh
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();

                // Loop through the material properties
                for (const key in child.material) {
                    const value = child.material[key];

                    // Test if there is a dispose function
                    if (value && typeof value.dispose === 'function') {
                        value.dispose();
                    }
                }
            }
        });

        this.world?.dispose();
        this.renderer?.dispose();
        this.time.destroy();
        this.sizes.destroy();

        this.debug.ui?.destroy();

        instance = null;
    }
}
