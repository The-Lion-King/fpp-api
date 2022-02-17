import {Context} from '../context';
import {ApiVersion} from '../base_types';
export default function versionCompatible(
  referenceVersion: ApiVersion,
  currentVersion: ApiVersion = Context.API_VERSION,
): boolean {
  if (
    currentVersion === ApiVersion.Unstable ||
    currentVersion === ApiVersion.Unversioned
  ) {
    return true;
  }
  const numericVersion = (version: string) =>
    parseInt(version.replace('-', ''), 10);
  const current = numericVersion(currentVersion);
  const reference = numericVersion(referenceVersion);
  return current >= reference;
}
