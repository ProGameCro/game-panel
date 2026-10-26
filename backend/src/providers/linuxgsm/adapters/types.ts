export type SteamCredentials = {
    username: string;
    password: string;
};

export type BeforeContainerCreateContext = {
    serverId: number;
    shortname: string;
    gameServerName: string;
    dataDir: string;
    steamCredentials: SteamCredentials | null;
    // the server's environment variables (KEY=VALUE)
    env?: string[];
    // the name given in the install form
    serverName?: string;
};

export type AfterContainerStartContext = {
    serverId: number;
    shortname: string;
    containerId: string;
};

export interface GameAdapter {
    beforeContainerCreate(ctx: BeforeContainerCreateContext): Promise<void>;
    afterContainerStart(ctx: AfterContainerStartContext): Promise<void>;
}
