export type ServerType = 'dns' | 'doh'

export interface Server extends Record<string, any> {
	key: string
	name: string
	servers: string[]
	avatar: string
	rate: number
	tags: string[]
	type?: ServerType
	dohUrl?: string
}
export interface ServerStore extends Server {
	isPin: boolean
}
