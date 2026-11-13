import UIEventBus from '../UI/EventBus';
import EventEmitter from './EventEmitter';

const MAX_DELTA = 100;

// Shared instance: `new Time()` anywhere returns the same clock, so only one
// requestAnimationFrame loop ever runs.
let instance: Time | null = null;

export default class Time extends EventEmitter {
    start: number;
    current: number;
    elapsed: number;
    delta: number;

    private rafId: number | null = null;
    private hiddenAt: number | null = null;
    /** Set by destroy(): the loop never restarts after a permanent stop. */
    private disabled = false;
    private onVisibilityChange: () => void;
    private onLoadingScreenDone: () => void;

    constructor() {
        super();

        if (instance) {
            return instance;
        }
        instance = this;

        // Setup
        this.start = performance.now();
        this.current = this.start;
        this.elapsed = 0;
        this.delta = 16;

        this.onVisibilityChange = () => {
            if (document.hidden) {
                this.hiddenAt = performance.now();
                this.stop();
                this.trigger('pause');
            } else {
                if (this.disabled) return;
                if (this.hiddenAt !== null) {
                    const hiddenFor = performance.now() - this.hiddenAt;
                    // Shift the clock so elapsed does not jump after the pause
                    this.start += hiddenFor;
                    this.current += hiddenFor;
                    this.hiddenAt = null;
                }
                this.resume();
                this.trigger('resume');
            }
        };
        document.addEventListener('visibilitychange', this.onVisibilityChange);

        this.onLoadingScreenDone = () => {
            this.start = performance.now();
        };
        UIEventBus.on('loadingScreenDone', this.onLoadingScreenDone);

        this.resume();
    }

    tick(timestamp: number) {
        this.rafId = window.requestAnimationFrame((t) => this.tick(t));

        this.delta = Math.min(Math.max(timestamp - this.current, 0), MAX_DELTA);
        this.current = timestamp;
        this.elapsed = this.current - this.start;

        this.trigger('tick');
    }

    /** Starts the shared loop if it is not running. */
    resume() {
        if (this.disabled || this.rafId !== null) return;
        this.current = performance.now();
        this.rafId = window.requestAnimationFrame((t) => this.tick(t));
    }

    /** Stops the shared loop. */
    stop() {
        if (this.rafId === null) return;
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    /**
     * Permanently stops the loop (used when WebGL is unavailable and on
     * teardown): visibility changes can no longer resume it.
     */
    destroy() {
        this.disabled = true;
        this.stop();
        document.removeEventListener(
            'visibilitychange',
            this.onVisibilityChange
        );
        UIEventBus.remove('loadingScreenDone', this.onLoadingScreenDone);
        instance = null;
    }
}
