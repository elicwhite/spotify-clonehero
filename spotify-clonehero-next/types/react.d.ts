/**
 * Type augmentations for non-standard DOM attributes used in this project.
 */

import 'react';

declare module 'react' {
  // The type parameter is unused here but has to be declared, and named as
  // React names it, for the interface to merge with React's own declaration.
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface InputHTMLAttributes<T> {
    /**
     * Makes a file input select a directory. Non-standard, but implemented by
     * every current browser, and the only way to read a folder in the ones
     * without `showDirectoryPicker`.
     *
     * Typed as a string, and written `webkitdirectory=""`, because React does
     * not know it as a boolean attribute: passing `true` warns and renders no
     * attribute at all, silently turning the input back into a file picker.
     */
    webkitdirectory?: string;
  }
}
