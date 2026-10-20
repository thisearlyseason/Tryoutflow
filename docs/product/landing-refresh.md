# Landing page refresh

The home page now includes an original training visual, an interactive four-stage workflow with real demonstration screenshots, a sample scorecard, feature sections, program links, six role guides, FAQs and a final call to action.

Content is server-rendered. Client components add workflow tabs with arrow/Home/End keyboard navigation, a local-only scoring sample and short, once-per-section entrance animations. No new animation dependency, account data, tracking or write requests are used. All motion respects reduced-motion preferences. Screenshots retain links to their original images.

## Generated asset

- Tool: built-in image_gen.
- Project asset: `public/images/tryout-training-hero.webp`.
- Original: `/Users/tylerans/.codex/generated_images/01a0a835-f44f-7d50-932d-8e34186829b4/exec-a77dced9-2ec3-45b3-a02f-e902512663d8.png`.
- Fictional adult athletes; no customer endorsement. The WebP is optimized and served through Next Image.

### Final generation prompt

Use case: photorealistic-natural. Asset type: hero photograph for TryoutFlow, a multi-sport tryout management website. Create an original premium editorial sports-training photograph, portrait 4:5 composition. An adult female soccer athlete with dark hair in a plain cobalt blue training jersey, navy shorts and white socks dynamically dribbles a soccer ball between small lime training cones on a deep green outdoor pitch. Two adult teammates softly out of focus in the distant background. Natural anatomy and realistic equipment, believable foot-ball relation and grounded running motion. Golden late-afternoon side light, warm skin tones, atmospheric dark green trees instead of stadium billboards, subtle film grain, crisp subject and shallow depth of field. The central athlete should be fully visible with feet and ball within the middle 65% of the composition. Leave the upper 15% and bottom 20% visually quiet for website overlays; no text, letters, numbers, logos, watermarks, sponsors or UI. Confident, energetic, human, aspirational sports campaign aesthetic, authentic practice rather than a trophy or victory pose. Fictional people, no real athlete likeness or endorsement.

## Review and release

Local evidence and the isolated build manifest are in `output/landing-refresh`. Deployed and verified on September 16, 2026 at https://www.tryout.agency/ with deployment `dpl_B2N6fTiehW7Mu7Xdi3ypraRUAAZR`. The release preserved the previously deployed role guides.
