# 3D simulator

3D simulator is the renamed Web application based on `davidll8819/teardown`, branch `codex/4yi-marketplace` (preview base: `d7e8531504bc0739e6250f99595357457764622e`). It provides a mechanical simulation workspace with reference-image uploads and analysis. The upstream Teardown skill, examples and credits are preserved below.

For 4yi deployment, use **3D simulator** as the application display name and the existing root `4yi-app.json` declaration. The local preview uses a separate loopback service and private task directory. A platform release must be built from the reviewed commit and tested through an installed organization instance. See [4yi integration notes](docs/4yi-web-integration.md) for runtime requirements and outstanding checks.

A Claude Code skill that turns any machine into a 3D simulator you can take apart.

Ask how something works. Claude builds it as one offline HTML page: the machine runs in the middle, every panel around it reads the real numbers, a button opens the part doing the work, and when nobody touches it the page tours itself.

![Mellis HB-7 robotic bee simulator](docs/bee.gif)

| Telson SC-8 robotic scorpion | Pelagos OC-8 robotic octopus |
|---|---|
| ![Telson SC-8 robotic scorpion](docs/scorpion.gif) | ![Pelagos OC-8 robotic octopus](docs/octopus.gif) |

## Install

```
npx skills add elvarofficial/teardown -g -a claude-code
```

Then, once, in the installed folder:

```
npm install && npx playwright install chromium
```

You need Node.js 20 or newer. For the video you also need `ffmpeg`, and for the sound Python 3.

## Use

Ask Claude Code in plain words:

> Build me a simulator of a 4-stroke motorcycle engine I can take apart.

> How does a mechanical watch keep time? Show me as a simulator.

> Make a teardown of a hydraulic excavator arm and record a 20-second video of it.

Or open one of the 3 examples first:

```
node sims/build.mjs v8-live          # teardown-out/dist/v8-live.html
node sims/build.mjs cessna-live
node sims/build.mjs strandbeest-live
```

## What is inside

| | |
|---|---|
| `SKILL.md` | What Claude reads: how a machine is built, the rules that make it look right, the review loop. |
| `sims/kit/` | Runtime, stage, shader warm-up. |
| `sims/v8-*`, `sims/cessna-*`, `sims/strandbeest-*` | 3 complete machines. `-shared` is the machine, `-live` the page you drive, `-film` the recorded tour. |
| `sims/build.mjs` | Bundles a machine into one HTML file, three.js and fonts inlined. |
| `sims/capture.mjs` | Renders the film frame by frame to a 60 fps mp4, or to review sheets of stills. |
| `sfx/`, `run_sfx.py` | Procedural sound on the film's timeline, mastered to −14 LUFS. |

## Credits

Built on [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT): the runtime, frame capture, sound engine and review rules come from there. Recorded samples are CC0 from Freesound, prepared by [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics); sources in `sfx/samples/SOURCES.md`.

MIT licence.

## 4yi Web prototype

This branch contains a local prototype for text-to-simulator generation. It is not yet a complete implementation of the upstream skill or a production-ready marketplace release. See [4yi Web integration notes](docs/4yi-web-integration.md) for the verified scope and remaining isolation and visual-review work.

New generated projects must use the shared exhibit runtime: live instruments,
named subsystem controls, assembled/cutaway/exploded views and a tour that yields
to the visitor. The generator still supplies the actual machine geometry and
kinematics. A compiled result is labelled separately from a visually or
interactively checked result. The optional local review worker checks several
views and controls and compares the result with the submitted reference images;
it remains a development-only executor, not an enabled production sandbox.

`node web/check-exhibit.mjs` exercises the shared controls in an independent local
Chrome with an empty profile and blocked network, using the original V8 as an
explicitly labelled, hand-authored regression fixture. Its screenshots are not
evidence that the AI can generate the README gallery's robot models. Web video
and audio recording are not implemented.

After `npm ci`, build the interface with `npm run build:web`. To run locally, provide `OPENAI_API_BASE`, `OPENAI_API_KEY`, and `TEXT_MODEL` in your process environment, set `TEARDOWN_LOCAL_MODE=1`, then run `npm run start:web`. Local mode listens on `127.0.0.1:3000`; never enable it for a shared deployment. For a model requiring it, set `TEARDOWN_REASONING_EFFORT=none`. Do not commit credentials.

Run the local tests with `npm run test:web`. Each user installs a dedicated instance through their personal organization. Before release, verify that each instance is accessible only to authorized users, that the trusted-router boundary holds, and that the installed model/token configuration and persistent storage work. The checked-in `4yi-app.json` is a deployment candidate, not evidence that those checks have passed.
