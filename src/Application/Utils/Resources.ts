import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import EventEmitter from './EventEmitter';
import Loading from './Loading';

// Sources whose failure leaves the scene visibly broken; surfaced in the
// loading screen with a ' FAILED' suffix.
const REQUIRED_SOURCES = new Set([
    'computerSetupModel',
    'environmentModel',
    'decorModel',
    'computerSetupTexture',
    'environmentTexture',
    'decorTexture',
]);

const MAX_ATTEMPTS = 2; // first try + one retry
const RETRY_DELAY_MS = 500;
const SMALL_SCREEN_QUERY = '(max-width: 767px)';
const SMALL_SCREEN_MAX_SIDE = 768;

const isSmallScreen = () =>
    window.matchMedia(SMALL_SCREEN_QUERY).matches ||
    Math.min(window.screen.width, window.screen.height) < SMALL_SCREEN_MAX_SIDE;

export default class Resources extends EventEmitter {
    sources: Resource[];
    items: {
        texture: { [name: string]: LoadedTexture };
        cubeTexture: { [name: string]: LoadedCubeTexture };
        gltfModel: { [name: string]: LoadedModel };
        audio: { [name: string]: LoadedAudio };
    };
    toLoad: number;
    loaded: number;
    loaders: {
        gltfLoader: GLTFLoader;
        textureLoader: THREE.TextureLoader;
        cubeTextureLoader: THREE.CubeTextureLoader;
        audioLoader: THREE.AudioLoader;
    };
    application: Application;
    loading: Loading;
    failedRequired: string[] = [];

    constructor(sources: Resource[]) {
        super();

        this.sources = sources;

        this.items = { texture: {}, cubeTexture: {}, gltfModel: {}, audio: {} };
        // Audio is deferred until 'ready' and never gates it.
        this.toLoad = this.sources.filter((s) => s.type !== 'audio').length;
        this.loaded = 0;
        this.application = new Application();
        this.loading = this.application.loading;

        this.setLoaders();
        this.startLoading();
    }

    setLoaders() {
        this.loaders = {
            gltfLoader: new GLTFLoader(),
            textureLoader: new THREE.TextureLoader(),
            cubeTextureLoader: new THREE.CubeTextureLoader(),
            audioLoader: new THREE.AudioLoader(),
        };
    }

    startLoading() {
        for (const source of this.sources) {
            if (source.type !== 'audio') this.loadSource(source, 1);
        }
    }

    /** Audio is off the critical path: fetched once the scene is ready. */
    private startAudioLoading() {
        for (const source of this.sources) {
            if (source.type === 'audio') this.loadSource(source, 1);
        }
    }

    loadSource(source: Resource, attempt: number) {
        const onError = (error: unknown) => this.sourceFailed(source, attempt, error);

        if (source.type === 'gltfModel') {
            this.loaders.gltfLoader.load(
                source.path,
                (file) => this.sourceLoaded(source, file),
                undefined,
                onError
            );
        } else if (source.type === 'texture') {
            this.loaders.textureLoader.load(
                source.pathSmall && isSmallScreen()
                    ? source.pathSmall
                    : source.path,
                (file) => {
                    file.encoding = THREE.sRGBEncoding;
                    this.sourceLoaded(source, file);
                },
                undefined,
                onError
            );
        } else if (source.type === 'cubeTexture') {
            this.loaders.cubeTextureLoader.load(
                source.path,
                (file) => this.sourceLoaded(source, file),
                undefined,
                onError
            );
        } else if (source.type === 'audio') {
            this.loaders.audioLoader.load(
                source.path,
                (buffer) => this.sourceLoaded(source, buffer),
                undefined,
                onError
            );
        }
    }

    sourceFailed(source: Resource, attempt: number, error: unknown) {
        if (attempt < MAX_ATTEMPTS) {
            window.setTimeout(
                () => this.loadSource(source, attempt + 1),
                RETRY_DELAY_MS
            );
            return;
        }

        console.warn(
            `Failed to load resource "${source.name}" after ${attempt} attempts`,
            error
        );
        UIEventBus.dispatch('loadError', { sourceName: source.name });
        this.loading.trigger('loadError', [source.name]);
        // Deferred audio is not part of the progress count.
        if (source.type === 'audio') return;
        // Count it as settled so 'ready' still fires.
        const required = REQUIRED_SOURCES.has(source.name);
        if (required) this.failedRequired.push(source.name);
        this.settle(required ? `${source.name} FAILED` : source.name);
    }

    sourceLoaded(source: Resource, file: LoadedResource) {
        // The per-type map is indexed by a union key; narrow via cast.
        (this.items[source.type] as { [name: string]: LoadedResource })[
            source.name
        ] = file;
        if (source.type === 'audio') {
            this.trigger('audioLoaded', [source.name]);
            return;
        }
        this.settle(source.name);
    }

    private settle(label: string) {
        this.loaded++;

        this.loading.trigger('loadedSource', [label, this.loaded, this.toLoad]);

        if (this.loaded === this.toLoad) {
            this.trigger('ready');
            this.startAudioLoading();
        }
    }
}
