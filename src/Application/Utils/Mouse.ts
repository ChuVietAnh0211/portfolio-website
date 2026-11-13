import EventEmitter from './EventEmitter';

/**
 * Mouse-like events forwarded by MonitorScreen. These are either native
 * MouseEvents from the document or CustomEvents re-dispatched from the
 * monitor iframe with clientX/clientY/inComputer patched on.
 */
export type ForwardedPointerEvent = Event & {
    clientX?: number;
    clientY?: number;
    inComputer?: boolean;
};

export default class Mouse extends EventEmitter {
    /** Last pointer position in CSS pixels (viewport space). */
    x: number;
    y: number;
    inComputer: boolean;

    private onPointerMove: (event: PointerEvent) => void;
    private onTouch: (event: TouchEvent) => void;

    constructor() {
        super();

        // Start at the viewport centre so the desk view is not biased to the
        // top-left before the first pointer event.
        this.x = window.innerWidth / 2;
        this.y = window.innerHeight / 2;
        this.inComputer = false;

        // Primary path: MonitorScreen re-triggers document mousemove (and
        // iframe-forwarded moves) through this emitter.
        this.on('mousemove', (event: ForwardedPointerEvent) => {
            this.setPosition(event.clientX, event.clientY);
            this.inComputer = !!event.inComputer;
        });

        // Pointer / touch input so camera parallax also works on touch devices.
        const passive: AddEventListenerOptions = { passive: true };
        this.onPointerMove = (event: PointerEvent) => {
            this.setPosition(event.clientX, event.clientY);
        };
        this.onTouch = (event: TouchEvent) => {
            const touch = event.touches[0];
            if (touch) this.setPosition(touch.clientX, touch.clientY);
        };
        window.addEventListener('pointermove', this.onPointerMove, passive);
        window.addEventListener('touchstart', this.onTouch, passive);
        window.addEventListener('touchmove', this.onTouch, passive);
    }

    destroy() {
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('touchstart', this.onTouch);
        window.removeEventListener('touchmove', this.onTouch);
        this.off('mousemove');
    }

    private setPosition(x: number | undefined, y: number | undefined) {
        // 0 is a valid coordinate; only reject missing / non-finite values.
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        this.x = x;
        this.y = y;
    }
}
