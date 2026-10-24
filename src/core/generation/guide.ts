// The generation passport guide for agents, answered by `buba:passport-help`: how to record what made a file,
// so that an agent on any computer with Buba finds the format from the command list alone. Kinds, roles,
// parameter keys and limits come from the code that checks a passport, so the guide cannot drift from it.
// English, like every command answer.
import { INBOX_DIR, INBOX_WAIT_MS, REJECTED_DIR, REQUEST_MAX_BYTES } from '../inbox/request.ts';
import {
  HIDDEN_MAX,
  KNOWN_ROLES,
  LINE_MAX,
  PARAM_VALUE_MAX,
  REFS_MAX,
  SHOWN_MAX,
  TEXT_MAX,
} from '../storage/passport.ts';
import { KINDS, PARAM_KEYS } from './params.ts';
import { LEAD_ROLES } from './refs.ts';

const list = (items: readonly string[]): string => items.map((item) => `\`${item}\``).join(', ');
const kb = (bytes: number): string => `${bytes / 1024} KB`;

/** The guide as Markdown. */
export function passportGuide(): string {
  return `# Buba generation passport

A passport records what made a file in the vault: model, provider, prompt, references, parameters, cost. Buba
shows it in the file panel under "Generation", and another agent can read it back to repeat the generation.
Write one every time you save a generated file into the vault.

## Steps

1. Save the result into the vault.
2. Save every reference as a file in the vault too (download pictures from the web or the chat first). A reference
   outside the vault is refused.
3. Write the passport, one of two ways:
   - Obsidian command line: \`obsidian buba:passport path=<result> passport='<JSON>'\`. Add \`canvas=<board.canvas>\`
     to also put the result card on a board.
   - Without the command line: a request file \`${INBOX_DIR}/<any name>.json\` with
     \`{"path": "<result>", "passport": {...}}\`. Write it as \`<name>.json.tmp\` and rename it to \`.json\`. Buba takes it
     within a few seconds and deletes it; a refused one moves to \`${REJECTED_DIR}/\` next to \`<name>.reason.txt\`.
     A request waits up to ${INBOX_WAIT_MS / 86_400_000} days for its files to arrive by sync. Over
     ${kb(REQUEST_MAX_BYTES)} it is not read. A long prompt is easier this way, also with
     \`obsidian buba:passport file=<request>\`.
4. Check: \`obsidian buba:passport-get path=<result>\` returns the passport and \`missing\` is empty.

To replace a passport, write it again. To remove one: \`obsidian buba:passport path=<result> clear=true\`, or a
request with \`"passport": null\`.

A refusal writes nothing: \`not-found\` (no such result), \`ref-not-found\` (\`data.missing\` lists the references not
in the vault), \`invalid\` (\`data\` names the field and the reason), \`too-large\` (a passport over ${kb(LINE_MAX)}),
\`bad-json\`. Fix it and repeat.

## Passport

\`\`\`json
{
  "kind": "video",
  "model": "Seedance 2.0",
  "provider": "fal.ai",
  "createdAt": "2026-10-23T08:00:00.000Z",
  "by": "Claude",
  "prompt": "The courier from @Image1 runs through the parking lot of @Video1",
  "refs": [
    { "path": "References/courier.png", "role": "image" },
    { "path": "References/parking.mp4", "role": "video" }
  ],
  "params": { "aspectRatio": "16:9", "resolution": "480p", "duration": 5, "seed": 1234 },
  "shown": [{ "label": "Camera", "value": "dolly in" }],
  "cost": { "amount": 0.35, "unit": "usd" },
  "hidden": { "providerJobId": "<job id>", "modelId": "<API model name>" }
}
\`\`\`

- Required: \`kind\`, \`model\`, \`provider\`, \`createdAt\`. Everything else only if you know it; never invent.
- \`kind\`: ${list(KINDS)}. Another short Latin word is shown as written.
- \`model\`, \`provider\`: the names a person uses, such as "Nano Banana Pro" and "Replicate".
- \`createdAt\`: ISO time or milliseconds, years 0000-9999. \`by\`: who made it, such as your name.
- \`prompt\`, \`negativePrompt\`, \`lyrics\`: the text exactly as sent, up to ${TEXT_MAX} characters each.
- \`refs\`: up to ${REFS_MAX}, in the order the model got them. Roles: ${list(KNOWN_ROLES)}; another role is shown
  as written. References with the roles ${list(LEAD_ROLES)} get no number. The others are numbered by file type in
  \`refs\` order: \`@Image1\`, \`@Image2\`, \`@Video1\`, \`@Audio1\`. So with a \`source\` picture and an \`image\`
  picture, the \`image\` one is \`@Image1\`. Buba turns these tags in the prompt into links to the files; keep them as
  sent. If the prompt calls a reference by another word, a numberless one too, put that word in its \`token\`.
- \`params\`: every generation setting, the seed included. Keys with a label in the panel: ${list(PARAM_KEYS)};
  other keys are shown as written. Values are text, numbers or true/false, up to ${PARAM_VALUE_MAX} characters.
  An integer over 9007199254740991 goes as text: \`"seed": "18446744073709551615"\`.
- \`shown\`: up to ${SHOWN_MAX} more label and value pairs for the panel.
- \`cost\`: \`unit\` is \`usd\`, \`credits\`, \`tokens\` or a short word.
- \`hidden\`: service ids only (job id, request id, API model name), up to ${kb(HIDDEN_MAX)} as JSON. Never shown in
  the panel; \`buba:passport-get\` and "Copy for agent" give it back. No keys or secrets here or anywhere.

## Reading

\`obsidian buba:passport-get path=<file>\` returns the passport with the current paths of its references and
\`missing: true\` on a reference no longer in the vault, plus \`usedIn\`: the files made from this one.
`;
}
