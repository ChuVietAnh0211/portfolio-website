import * as THREE from 'three';
import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from './Application';
import Sizes from './Utils/Sizes';
import Camera from './Camera/Camera';
import screenVert from './Shaders/screen/vertex.glsl';
import screenFrag from './Shaders/screen/fragment.glsl';
import Time from './Utils/Time';
import { motionPreference } from './Camera/CameraKeyframes';

export default class Renderer {
    application: Application;
    sizes: Sizes;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    time: Time;
    overlay: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    overlayScene: THREE.Scene;
    camera: Camera;
    overlayInstance: THREE.WebGLRenderer;
    instance: THREE.WebGLRenderer;
    cssInstance: CSS3DRenderer;
    uniforms: { u_time: THREE.IUniform<number> };
    contextLost: boolean;
    frame: number;
    grainDirty: boolean;
    wasReduced: boolean;

    constructor() {
        this.application = new Application();
        this.time = this.application.time;
        this.sizes = this.application.sizes;
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.overlayScene = this.application.overlayScene;
        this.camera = this.application.camera;
        this.contextLost = false;
        this.frame = 0;
        this.grainDirty = true;
        this.wasReduced = motionPreference.reduced;

        this.setInstance();
    }

    setInstance() {
        // Throws if WebGL is unavailable; Application handles that case.
        this.instance = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        this.instance.outputEncoding = THREE.sRGBEncoding;
        this.instance.setPixelRatio(Math.min(this.sizes.pixelRatio, 2));
        this.instance.setSize(this.sizes.width, this.sizes.height);
        this.instance.setClearColor(0x000000, 0.0);

        // Style. No z-index: stacking relies on the DOM order of the layer
        // containers in index.html (#css < #webgl < #overlay < #ui), so the
        // grain overlay and the React UI stay above this opaque canvas.
        this.instance.domElement.style.position = 'absolute';
        this.instance.domElement.style.top = '0px';

        this.instance.domElement.addEventListener(
            'webglcontextlost',
            this.onContextLost
        );
        this.instance.domElement.addEventListener(
            'webglcontextrestored',
            this.onContextRestored
        );

        document.querySelector('#webgl')?.appendChild(this.instance.domElement);

        // Film-grain overlay: cheap, low-res, rendered at ~30 fps
        this.overlayInstance = new THREE.WebGLRenderer({
            antialias: false,
            alpha: false,
            powerPreference: 'low-power',
        });
        this.overlayInstance.setPixelRatio(1);
        this.overlayInstance.setSize(this.sizes.width, this.sizes.height);
        this.overlayInstance.domElement.style.position = 'absolute';
        this.overlayInstance.domElement.style.top = '0px';
        this.overlayInstance.domElement.style.mixBlendMode = 'soft-light';
        this.overlayInstance.domElement.style.opacity = '0.12';
        this.overlayInstance.domElement.style.pointerEvents = 'none';

        document
            .querySelector('#overlay')
            ?.appendChild(this.overlayInstance.domElement);

        this.cssInstance = new CSS3DRenderer();
        this.cssInstance.setSize(this.sizes.width, this.sizes.height);
        this.cssInstance.domElement.style.position = 'absolute';
        this.cssInstance.domElement.style.top = '0px';

        document
            .querySelector('#css')
            ?.appendChild(this.cssInstance.domElement);

        this.uniforms = {
            u_time: { value: 1 },
        };

        // Full-screen quad: the vertex shader writes `position` straight to
        // clip space, so a 2x2 plane covers the viewport from any camera.
        this.overlay = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.ShaderMaterial({
                vertexShader: screenVert,
                fragmentShader: screenFrag,
                uniforms: this.uniforms,
                depthTest: false,
                depthWrite: false,
            })
        );

        this.overlay.frustumCulled = false;

        this.overlayScene.add(this.overlay);
    }

    onContextLost = (event: Event) => {
        event.preventDefault();
        this.contextLost = true;
    };

    onContextRestored = () => {
        this.contextLost = false;
    };

    resize() {
        // Pixel ratio first so setSize reallocates the drawing buffer once
        this.instance.setPixelRatio(Math.min(this.sizes.pixelRatio, 2));
        this.instance.setSize(this.sizes.width, this.sizes.height);

        this.cssInstance.setSize(this.sizes.width, this.sizes.height);

        this.overlayInstance.setPixelRatio(1);
        this.overlayInstance.setSize(this.sizes.width, this.sizes.height);
        this.grainDirty = true;
    }

    update() {
        this.frame++;

        if (!this.contextLost) {
            this.instance.render(this.scene, this.camera.instance);
        }
        this.cssInstance.render(this.cssScene, this.camera.instance);

        const reduced = motionPreference.reduced;
        if (reduced !== this.wasReduced) {
            this.wasReduced = reduced;
            this.grainDirty = true;
        }

        if (reduced) {
            // Static grain: render once (and after resize / preference flip)
            if (this.grainDirty) {
                this.grainDirty = false;
                this.uniforms.u_time.value = (this.time.elapsed * 0.001) % 1000;
                this.overlayInstance.render(
                    this.overlayScene,
                    this.camera.instance
                );
            }
        } else if (this.frame % 2 === 0) {
            // Grain only needs ~30 fps to read as film noise
            // Seconds, wrapped to keep shader precision; only fract() is used
            this.uniforms.u_time.value = (this.time.elapsed * 0.001) % 1000;
            this.overlayInstance.render(this.overlayScene, this.camera.instance);
        }
    }

    dispose() {
        const canvas = this.instance.domElement;
        canvas.removeEventListener('webglcontextlost', this.onContextLost);
        canvas.removeEventListener(
            'webglcontextrestored',
            this.onContextRestored
        );

        this.overlayScene.remove(this.overlay);
        this.overlay.geometry.dispose();
        this.overlay.material.dispose();

        this.instance.dispose();
        this.overlayInstance.dispose();

        canvas.remove();
        this.overlayInstance.domElement.remove();
        this.cssInstance.domElement.remove();
    }
}
