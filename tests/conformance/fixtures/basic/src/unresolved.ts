// Imports a module that does not exist; exercises unresolved-imports.
import { stuff } from 'this-module-does-not-exist';

export const ref = stuff;
