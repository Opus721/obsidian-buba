// The passport as an agent gets it ("Copy for agent", `buba:passport-get`): the request `buba:passport`
// takes, so another agent can repeat it as is. References carry their current path; a reference not found
// in the vault keeps its recorded path and gets `missing: true`. Fingerprints stay inside Buba; `hidden` is
// given whole. No `obsidian` import.
import type { Passport, PassportRef } from '../storage/passport.ts';

/** Where a reference is now: its recorded path, a file found by fingerprint, or `null`. */
export type RefLocator = (ref: PassportRef) => string | null;

export type AgentRef = Omit<PassportRef, 'fp'> & { missing?: true };

export interface AgentPassport {
  path: string;
  passport: Omit<Passport, 'refs'> & { refs?: AgentRef[] };
}

export function agentPassport(path: string, passport: Passport, locate: RefLocator): AgentPassport {
  const { refs, ...rest } = passport;
  if (!refs) return { path, passport: { ...rest } };
  return {
    path,
    passport: {
      ...rest,
      refs: refs.map((ref) => {
        const { fp: _fp, ...plain } = ref;
        const now = locate(ref);
        return now === null ? { ...plain, missing: true } : { ...plain, path: now };
      }),
    },
  };
}
