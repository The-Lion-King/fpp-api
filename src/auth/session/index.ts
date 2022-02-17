import {Session} from './session';
import {SessionStorage} from './session_storage';
import {MemorySessionStorage} from './storage/memory';
import {CustomSessionStorage} from './storage/custom';

const FppSession = {
  Session,
  MemorySessionStorage,
  CustomSessionStorage,
};

export default FppSession;
export {Session, SessionStorage, MemorySessionStorage, CustomSessionStorage};
