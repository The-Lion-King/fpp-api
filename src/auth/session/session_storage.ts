import {SessionInterface} from './types';

interface SessionStorage {

  storeSession(session: SessionInterface): Promise<boolean>;

  loadSession(id: string): Promise<SessionInterface | undefined>;

  deleteSession(id: string): Promise<boolean>;
}

export {SessionStorage};
