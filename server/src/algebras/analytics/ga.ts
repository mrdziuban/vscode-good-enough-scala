import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import * as ua from "universal-analytics";
import { autobind, Do } from "../../util";
import { MkRef } from "../ref";
import { Settings } from "../settings";
import { Analytics } from "./index";

export const ga = <M extends URIS>(M: Monad1<M>, S: Settings<M>, R: MkRef<M>, machineId: string): Analytics<M> => {
  const clientRef = autobind(R(ua("UA-43398941-7", machineId)));

  const whenEnabled = <A>(t: Type<M, A>): Type<M, A | undefined> => Do(M)(function*() {
    const analyticsEnabled: boolean = yield S.get("analyticsEnabled");
    return yield analyticsEnabled ? t : M.of(undefined);
  });

  return {
    trackEvent: (category: string, action: string, label?: string, value?: number): Type<M, void> =>
      whenEnabled(M.map(clientRef.read(), (client: ua.Visitor) =>
        (label && value ? client.event(category, action, label, value) : client.event(category, action)).send())),

    trackTiming: (category: string, action: string, duration: number): Type<M, void> =>
      whenEnabled(M.map(clientRef.read(), (client: ua.Visitor) => client.timing(category, action, duration).send()))
  };
};
