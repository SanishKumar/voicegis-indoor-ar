# README captures

Captured from the running application on 6 October 2026 using the bundled
Meridian Park Medical Campus venue.

- `voicegis-walkthrough.gif`: campus overview, Main Hospital interior, Level 1,
  2D plan, destination search, and a Main Gate → Cardiology Clinic route preview.
  1120 × 630, approximately 22 seconds; pauses shortened for the loop.
- `campus.jpg`: public visitor campus overview.
- `campus-route.jpg`: the same route shown in 3D.
- `inspector.jpg`: operator Inspector, ground floor, Cardiology Clinic selected,
  routing graph enabled.

The walkthrough uses map exploration and instruction previews. It does not
depict live handset positioning or an AR field test. The screenshots contain
the app's own interface and synthetic venue data.

To refresh the captures, run the app, select Meridian Park, browse the map,
then follow the route setup in the root README. Use the public build for visitor
captures and the operator build for Inspector. Keep a still campus image linked
beside the animation.

## Mobile captures · 7 October 2026

Captured at 390 × 844 CSS pixels (the captured image is 390 × 843 pixels):

- `mobile-walkthrough.gif`: Meridian Park exploration, Cardiology search,
  a folded route panel, 2D/3D switching and instruction preview from the
  Main Gate through the garden into the hospital. Approximately 22 seconds.
- `mobile-campus.jpg`: campus overview before starting a journey.
- `mobile-route.jpg`: outdoor route with compact directions.
- `mobile-indoor.jpg`: the same trip inside Main Hospital.
- `mobile-camera.jpg`: the actual camera direction overlay.
- `mobile-ar.jpg`: the actual immersive renderer after floor confirmation,
  with the AR controls folded.

The last two images use a generated background, `hallway-simulation.png`,
with simulated camera, orientation and WebXR inputs. The app's interface,
route graphics and floor-confirmation controls are rendered by the application,
not painted into a mockup. Both carry **SIMULATED SCENE · PRODUCT INTERFACE**.
They are not recordings of a handset, a surveyed corridor or a field test.

To reproduce those two captures, run `npm run dev` and open
`/scripts/showcase.html?checkin=voicegis://asterion/g/east#/visitor` on the
printed localhost address. Search for Civic Plaza Entrance, navigate, open
Camera view and choose “I'm facing the corridor”. Start AR, confirm the
simulated floor when offered, and fold the controls. The fixture is a separate
development page; neither production build includes it. It must not be used
to assess localization accuracy or hardware support.

Background created with the built-in image-generation tool. Final prompt:

> Use case: photorealistic-natural. Asset type: simulated camera background for a
> hospital indoor-navigation demo (not a UI mockup). Create a portrait 9:19
> photograph of an empty, modern hospital corridor, straight for about 25 metres,
> pale stone floor, subtle realistic tile seams, off-white walls with pale wood
> door surrounds, windows along one side, natural daylight, clean contemporary
> building. Viewpoint: rear smartphone camera held about 1.4m high, tilted downward
> 15 degrees. Single vanishing point horizontally centred at about 25% from the
> top of the frame, with an uninterrupted broad floor occupying the lower half.
> Moderate 55-degree vertical field of view. Everyday natural lighting and
> texture, not glossy fantasy architecture. No people, no trolley, no signs with
> text, no navigation graphics, no arrows, no UI, no frame, no logos or watermark.
> The application will add its own genuine interface and floor route on top.

The phone walkthrough and map stills do not use this background. They are
captures of the included synthetic campus, with no camera or sensor simulation.
