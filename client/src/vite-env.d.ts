/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Optional tldraw license key passed to <Tldraw licenseKey={...} /> at build time. */
	readonly VITE_TLDRAW_LICENSE_KEY?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
