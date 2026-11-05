declare let __webpack_public_path__: string;

if (typeof window !== 'undefined') {
  try {
    __webpack_public_path__ = new URL('.', window.location.href).href;
  } catch (error) {
    console.error('Unable to set __webpack_public_path__', error);
  }
}
