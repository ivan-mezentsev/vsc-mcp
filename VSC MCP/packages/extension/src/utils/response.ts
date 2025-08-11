export interface ToolResponse {
  text: string;
  images?: string[];
}

export const formatResponse = {
  toolResult(text: string, images?: string[]): ToolResponse {
    return {
      text,
      images,
    };
  },
};