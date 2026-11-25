/** Private in-process lineage. JSON cannot expose these references. */
const acceptedInputOrigins = Symbol("accepted-input-origins");

export type AcceptedInputOriginCarrier = {
  [acceptedInputOrigins]?: readonly string[];
};

const MAX_INPUT_ORIGINS = 32;
const MAX_INPUT_ID_LENGTH = 256;

export function readAcceptedInputOrigins(value: object): readonly string[] | undefined {
  return (value as AcceptedInputOriginCarrier)[acceptedInputOrigins];
}

/** Call only after the accepted input revision has actually been qualified. */
export function bindAcceptedInputOrigins<T extends object>(value: T, inputIds: readonly string[]): T {
  const { [acceptedInputOrigins]: _previous, ...plain } = value as T & AcceptedInputOriginCarrier;
  if (inputIds.length === 0 || inputIds.length > MAX_INPUT_ORIGINS ||
      inputIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > MAX_INPUT_ID_LENGTH)) {
    return plain as T;
  }
  return {
    ...plain,
    [acceptedInputOrigins]: Object.freeze([...new Set(inputIds)]),
  } as T;
}

/** A missing contributor invalidates the complete origin chain. */
export function inheritAcceptedInputOrigins<T extends object>(value: T, ...sources: object[]): T {
  const all = sources.map(readAcceptedInputOrigins);
  if (all.length === 0 || all.some((ids) => !ids?.length)) {
    return bindAcceptedInputOrigins(value, []);
  }
  return bindAcceptedInputOrigins(value, [...new Set(all.flatMap((ids) => ids!))]);
}
