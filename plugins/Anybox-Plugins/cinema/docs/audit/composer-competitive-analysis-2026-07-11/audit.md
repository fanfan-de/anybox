# Composer competitive visual analysis

## Scope

Comparison of the supplied competitor text composer and the supplied Anybox Cinema text composer screenshot. This is a screenshot-based visual and UX review; interaction behavior, keyboard flow, focus states, and measured contrast were not tested.

## Step 1 — Competitor composer

Health: Strong visual hierarchy, with accessibility caveats.

- A single outer surface contains attachment, prompt, mode/model controls, and submit.
- Internal regions are separated by whitespace rather than nested borders.
- The primary action is easy to find; secondary controls remain quiet.
- The model and mode controls read like lightweight toolbar actions instead of form fields.
- Risks: placeholder contrast appears low, several controls are small, and icon-only actions need accessible labels and visible focus states.

## Step 2 — Anybox composer

Health: Functionally clear, visually over-specified.

- The title, reference-image panel, prompt field, model selector, outer panel, and submit button each create a separate visual boundary.
- Repeated borders and rounded rectangles compete at nearly the same strength, making the composer feel like a settings form.
- Cyan is used for several structural and decorative elements, so it does not clearly identify the most important state or action.
- Strengths: controls are explicit, targets are generous, the image capability is discoverable, and the disabled action is unambiguous.

## Highest-impact direction

1. Keep one outer composer surface and remove inner field borders.
2. Place the image slot at the top-left inside that surface; let thumbnails grow horizontally.
3. Use the center as an open prompt area with no separate textarea card.
4. Move generation type and model into a quiet bottom toolbar; do not render the model as a full-width select field.
5. Keep the circular submit action at the bottom-right and reserve cyan for selection, connectivity, and active state.
6. Target a compact 480–560 px width and roughly 190–230 px empty-state height.

## Evidence

- `01-competitor-composer.png`
- `02-anybox-text-composer.png`
