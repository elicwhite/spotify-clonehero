type SentryEventLike = {
  message?: string;
  exception?: {
    values?: Array<{
      value?: string;
    }>;
  };
};

const exactMessages = new Set([
  'User canceled picker',
  'Not authenticated or no Spotify token',
  'The request is not allowed by the user agent or the platform in the current context.',
]);

const messagePrefixes = [
  'Spotify History: Did not expect to see subfolders.',
  'Spotify History: Unexpected file contents in ',
  'Spotify History: Expected to find a ReadMeFirst.pdf file.',
  "Failed to execute 'getFile' on 'FileSystemFileHandle'",
];

const messageFragments = ['Spotify is unavailable in this country'];

function isExpectedMessage(message: string): boolean {
  return (
    exactMessages.has(message) ||
    messagePrefixes.some(prefix => message.startsWith(prefix)) ||
    messageFragments.some(fragment => message.includes(fragment))
  );
}

export function isExpectedUserFlowEvent(event: SentryEventLike): boolean {
  const messages = [
    event.message,
    ...(event.exception?.values?.map(value => value.value) ?? []),
  ];

  return messages.some(
    message => message !== undefined && isExpectedMessage(message),
  );
}
