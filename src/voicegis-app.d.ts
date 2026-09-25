/** The commit the build was made from; see vite.config.js. */
declare const __APP_REVISION__: string;

declare module '#voicegis-app' {
  import type { ComponentType } from 'react';

  const App: ComponentType;
  export default App;
}
