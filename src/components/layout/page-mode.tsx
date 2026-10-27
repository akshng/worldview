"use client";
/** Panels render as full pages inside the app shell (true) or as pop-overs (false). */
import { createContext, useContext } from "react";

export const PageModeContext = createContext(false);
export const usePageMode = () => useContext(PageModeContext);
