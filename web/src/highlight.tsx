// The thread that ties text to the stage: hovering anything in the chat that names a file lights it up on the map.
import { createContext, useContext } from 'react';

export type Highlight = { paths: string[]; set: (paths: string[] | null) => void; known: (p: string) => string | null };
export const HighlightContext = createContext<Highlight>({ paths: [], set: () => {}, known: () => null });
export const useHighlight = () => useContext(HighlightContext);
