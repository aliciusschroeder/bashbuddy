import { JSONParser } from "@streamparser/json-node";
import { parse as parseYaml } from "yaml";

import type { LLMResponse } from "@bashbuddy/validators";
import { isDev } from "@bashbuddy/consts";
import { llmResponseSchema } from "@bashbuddy/validators";

function safeParseJson(stringifiedJson: string): unknown {
  try {
    return JSON.parse(stringifiedJson);
  } catch {
    return null;
  }
}

export class ResponseParseError extends Error {
  constructor() {
    super("Failed to parse LLM response");
  }
}

export async function parseLLMResponse(
  stream: AsyncIterable<string>,
  cb: (response: Partial<LLMResponse>) => void,
): Promise<LLMResponse> {
  const parser = new JSONParser({
    emitPartialTokens: true,
    stringBufferSize: 0,
    keepStack: true,
    emitPartialValues: true,
  });
  let finalResponse = "";

  parser.on("data", ({ key, value, parent }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    let data: Record<string, unknown> = {
      ...parent,
    };

    if (key) {
      data = {
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        [key]: value,
      };
    }

    // Kinda parsing the response with zod
    const parsed = llmResponseSchema.partial().safeParse(data);
    if (parsed.success) {
      cb(parsed.data);
    }
  });

  parser.on("error", (error) => {
    if (isDev) {
      console.error("DEV ONLY", error);
    }
  });

  for await (const chunk of stream) {
    finalResponse += chunk;
    parser.write(chunk);
  }

  parser.end();

  const parsedFinalResponse = llmResponseSchema.safeParse(
    safeParseJson(finalResponse),
  );

  if (!parsedFinalResponse.success) {
    if (isDev) {
      console.error(
        `DEV ONLY Failed to parse final response ${JSON.stringify(
          parsedFinalResponse.error,
          null,
          2,
        )} ${finalResponse}`,
      );
    }
    throw new ResponseParseError();
  }

  return parsedFinalResponse.data;
}

export async function parseYamlResponse(
  stream: AsyncIterable<string>,
  cb: (response: Partial<LLMResponse>) => void,
): Promise<{ parsed: LLMResponse; raw: string }> {
  let finalResponse = "";

  for await (const chunk of stream) {
    finalResponse += chunk;
    try {
      // Clean up YAML code block markers before attempting to parse
      const cleanedResponse = removeYamlCodeBlockMarkers(finalResponse);
      const parsed = llmResponseSchema.safeParse(parseYaml(cleanedResponse));
      if (parsed.success) {
        cb(parsed.data);
      }
    } catch {
      // Do nothing
    }
  }

  // Clean up YAML code block markers in the final response
  const cleanedFinalResponse = removeYamlCodeBlockMarkers(finalResponse);

  const parsedFinalResponse = llmResponseSchema.safeParse(
    parseYaml(cleanedFinalResponse),
  );

  if (!parsedFinalResponse.success) {
    if (isDev) {
      console.error(
        `DEV ONLY Failed to parse final response ${JSON.stringify(
          parsedFinalResponse.error,
          null,
          2,
        )} ${finalResponse}`,
      );
    }

    throw new ResponseParseError();
  }

  return { parsed: parsedFinalResponse.data, raw: cleanedFinalResponse };
}

/**
 * Removes YAML code block markers from a string
 */
function removeYamlCodeBlockMarkers(text: string): string {
  // Remove ```yaml at the beginning
  let cleaned = text.replace(/^\s*```yaml\s*/i, "");

  // Remove ``` at the end
  cleaned = cleaned.replace(/\s*```\s*$/, "");

  return cleaned;
}
