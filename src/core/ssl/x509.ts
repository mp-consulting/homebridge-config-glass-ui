// @peculiar/x509, loaded after the Reflect metadata API: its tsyringe
// dependency throws at import time without it, and the startup path
// (getStartupConfig) can load the certificate generator before Nest has
// pulled in reflect-metadata. Import the library from here, not directly.
import 'reflect-metadata'

export * from '@peculiar/x509'
