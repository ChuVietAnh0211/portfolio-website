import * as THREE from 'three';
import Application from '../Application';
import { AmbienceAudio, ComputerAudio } from './AudioSources';
import UIEventBus from '../UI/EventBus';

const POS_DEBUG = false;
const DEFAULT_REF_DISTANCE = 10000;
const ONE_SHOT_MAX_WAIT_MS = 1500;

type PlayOptions = {
    volume?: number;
    randDetuneScale?: number;
    loop?: boolean;
    filter?: {
        type: BiquadFilterType;
        frequency: number;
    };
    position?: THREE.Vector3;
    refDistance?: number;
    pitch?: number;
};

type PendingRequest = {
    sourceName: string;
    options: PlayOptions;
    poolKey: string;
    requestedAt: number;
};
export default class Audio {
    application: Application;
    listener: THREE.AudioListener;
    context: AudioContext;
    loadedAudio: { [key in string]: LoadedAudio };
    audioPool: { [key in string]: THREE.Audio<GainNode | PannerNode> };
    audioSources: {
        computer: ComputerAudio;
        ambience: AmbienceAudio;
    };
    scene: THREE.Scene;
    // Requests made before their buffer arrived (audio loads after 'ready').
    private pending: PendingRequest[] = [];
    private pendingCounter = 0;

    constructor() {
        this.application = new Application();
        this.listener = new THREE.AudioListener();
        this.application.camera.instance.add(this.listener);
        // Same object Resources fills, so late buffers are visible here.
        this.loadedAudio = this.application.resources.items.audio;
        this.application.resources.on('audioLoaded', (name: string) =>
            this.onAudioLoaded(name),
        );
        this.scene = this.application.scene;
        this.audioPool = {};

        this.audioSources = {
            computer: new ComputerAudio(this),
            ambience: new AmbienceAudio(this),
        };

        UIEventBus.on('loadingScreenDone', () => {
            setTimeout(() => {
                const AudioContext =
                    window.AudioContext ||
                    (
                        window as unknown as {
                            webkitAudioContext: typeof window.AudioContext;
                        }
                    ).webkitAudioContext;
                this.context = new AudioContext();
                this.context.resume();
            }, 100);
        });

        UIEventBus.on('muteToggle', (mute: boolean) => {
            this.listener.setMasterVolume(mute ? 0 : 1);
        });
    }

    playAudio(sourceName: string, options: PlayOptions = {}) {
        // Resume context if it's suspended
        if (this.context) this.context.resume();

        // Get the audio source
        const requested = sourceName;
        sourceName = this.getRandomVariant(requested);

        if (!sourceName) {
            // Buffer has not arrived yet: remember the request.
            const poolKey = requested + '_pending_' + this.pendingCounter++;
            this.pending.push({
                sourceName: requested,
                options,
                poolKey,
                requestedAt: performance.now(),
            });
            return poolKey;
        }

        const poolKey = sourceName + '_' + Object.keys(this.audioPool).length;
        return this.startAudio(sourceName, poolKey, options);
    }

    private onAudioLoaded(name: string) {
        const now = performance.now();
        this.pending = this.pending.filter((req) => {
            if (!name.includes(req.sourceName)) return true;
            // One-shots are only worth playing if they are still timely.
            if (
                req.options.loop ||
                now - req.requestedAt <= ONE_SHOT_MAX_WAIT_MS
            ) {
                this.startAudio(name, req.poolKey, req.options);
            }
            return false;
        });
    }

    private startAudio(
        sourceName: string,
        poolKey: string,
        options: PlayOptions,
    ) {
        // Setup
        const buffer = this.loadedAudio[sourceName];

        let audio: THREE.Audio<GainNode | PannerNode> = new THREE.Audio(
            this.listener,
        );

        if (options.position) {
            const positional = new THREE.PositionalAudio(this.listener);
            audio = positional;

            positional.setRefDistance(
                options.refDistance || DEFAULT_REF_DISTANCE,
            );

            const extraMaterialOptions = !POS_DEBUG
                ? {
                      transparent: true,
                      opacity: 0,
                  }
                : {};

            const sphere = new THREE.SphereGeometry(100, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                ...extraMaterialOptions,
            });
            const mesh = new THREE.Mesh(sphere, material);

            mesh.position.copy(options.position);
            mesh.name = poolKey;
            this.scene.add(mesh);
        }
        audio.setBuffer(buffer);

        if (options.filter) {
            const ac = audio.context;
            const filter = ac.createBiquadFilter();
            filter.type = options.filter.type; // Low pass filter
            filter.frequency.setValueAtTime(
                options.filter.frequency,
                ac.currentTime,
            );
            // filter.frequency.linearRampToValueAtTime(2400, ac.currentTime + 2);

            audio.setFilter(filter);
        }

        // Set options
        audio.setLoop(options.loop ? true : false);
        audio.setVolume(options.volume || 1);

        audio.play();

        // add a filter to the audio

        // Calculate detune
        const detuneAmount =
            (Math.random() * 200 - 100) *
            (options.randDetuneScale ? options.randDetuneScale : 0);

        // Set detune after .play is called
        audio.setDetune(detuneAmount);

        if (options.pitch) {
            audio.setDetune(options.pitch * 100);
        }

        // Add to pool
        if (audio.source) {
            audio.source.onended = () => {
                delete this.audioPool[poolKey];
                if (options.position) {
                    const positionalObject =
                        this.scene.getObjectByName(poolKey);
                    if (positionalObject) {
                        this.scene.remove(positionalObject);
                    }
                }
            };
            this.audioPool[poolKey] = audio;
        }
        return poolKey;
    }

    setAudioFilterFrequency(audio: string, frequency: number) {
        const a = this.audioPool[audio];

        if (a) {
            const ac = a.context;
            const filter = a.getFilter() as BiquadFilterNode;
            // clamp the frequency between 0 and 22500
            const f = Math.max(0, Math.min(22050, frequency));

            filter.frequency.setValueAtTime(f, ac.currentTime);
        }
    }

    setAudioVolume(audio: string, volume: number) {
        const a = this.audioPool[audio];
        if (a) {
            a.setVolume(volume);
        }
    }

    getRandomVariant(sourceName: string) {
        const variants = [];
        for (const key in this.loadedAudio) {
            if (key.includes(sourceName)) {
                variants.push(key);
            }
        }
        return variants[Math.floor(Math.random() * variants.length)];
    }

    update() {
        for (const key in this.audioSources) {
            const _key = key as keyof typeof this.audioSources;
            this.audioSources[_key].update();
        }
    }
}
