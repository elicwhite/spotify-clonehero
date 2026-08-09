import AppleMusicConnectClient from './AppleMusicConnectClient';

export default async function AppleMusicConnectPage({
  searchParams,
}: {
  searchParams: Promise<{returnTo?: string}>;
}) {
  const {returnTo} = await searchParams;
  return (
    <AppleMusicConnectClient {...(returnTo === undefined ? {} : {returnTo})} />
  );
}
