import Kefir = require("kefir");
import Settings from "./settings";
import { now, tap } from "./util";
import ua = require("universal-analytics");

const gaId = "UA-43398941-7";

const whenEnabled = <A>(fn: () => A): A | undefined => Settings.get().analyticsEnabled ? fn() : undefined;

const clientStream = Kefir.pool<ua.Visitor, {}>();

interface GAEvent {
  category: string;
  action: string;
  label?: string;
  value?: number;
}
const eventStream = Kefir.pool<GAEvent, {}>();
Kefir.combine<any, {}, void>([clientStream, eventStream], (client: ua.Visitor, event: GAEvent) =>
  whenEnabled(() => (event.label && event.value
    ? client.event(event.category, event.action, event.label, event.value)
    : client.event(event.category, event.action)).send())).observe();

interface GATiming { category: string; action: string; duration: number; }
const timingStream = Kefir.pool<GATiming, {}>();
Kefir.combine<any, {}, void>([clientStream, timingStream], (client: ua.Visitor, timing: GATiming) =>
  whenEnabled(() => client.timing(timing.category, timing.action, timing.duration).send())).observe();

export const Analytics = { // tslint:disable-line variable-name
  init: (machineId: string): void => { clientStream.plug(Kefir.constant(ua(gaId, machineId))); },

  trackEvent: (category: string, action: string, label?: string, value?: number): void => {
    eventStream.plug(Kefir.constant({ category, action, label, value }));
  },

  trackTiming: (category: string, action: string, duration: number): void => {
    timingStream.plug(Kefir.constant({ category, action, duration }));
  },

  trackTimedResult: <A>(start: number, category: string, action: string) => (a: A): A => {
    setImmediate(() => {
      Array.isArray(a)
        ? Analytics.trackEvent(category, action, "results", a.length)
        : Analytics.trackEvent(category, action);
      Analytics.trackTiming(category, action, now() - start);
    });
    return a;
  },

  timed: (category: string, action: string) => <A>(fn: () => A): A => {
    const start = now();
    const res = fn();
    Analytics.trackTimedResult(start, category, action)(res);
    return res;
  },

  timedAsync: (category: string, action: string) => <A>(fn: () => PromiseLike<A>): PromiseLike<A> => {
    const start = now();
    return fn().then(tap(Analytics.trackTimedResult(start, category, action)));
  }
};
