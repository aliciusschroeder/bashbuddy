import * as p from "@clack/prompts";
import chalk from "chalk";
import { Command } from "commander";

import type { AIModel } from "../utils/models";
import { ConfigManager, LOCAL_MODE } from "../utils/config";
import { DownloadManager } from "../utils/downloadManager";
import { availableModels, ModelManager } from "../utils/models";

/**
 * Select a model from the available models
 * @returns The selected model or null if cancelled
 */
async function selectModel(): Promise<AIModel | null> {
  const models = await ModelManager.checkDownloadedModels(availableModels);

  // Sort models: recommended first, then downloaded, then the rest
  const sortedModels = [...models].sort((a, b) => {
    // Recommended models at the top
    if (a.recommended && !b.recommended) return -1;
    if (!a.recommended && b.recommended) return 1;

    // Then downloaded models
    if (a.isDownloaded && !b.isDownloaded) return -1;
    if (!a.isDownloaded && b.isDownloaded) return 1;

    // Default to original order
    return 0;
  });

  const choices = sortedModels.map((model) => ({
    value: model.id,
    // Add green checkmark for downloaded models, green tag for recommended models
    label: `${model.isDownloaded ? chalk.green("✓ ") : "  "}${model.name} (${model.size})${model.recommended ? chalk.green(" [Recommended]") : ""}`,
    hint: model.isDownloaded ? "Downloaded" : "Not downloaded",
  }));

  const selectedModelId = await p.select({
    message: "Select an AI model",
    options: choices,
  });

  if (p.isCancel(selectedModelId)) {
    p.cancel("Operation cancelled");
    return null;
  }

  const selectedModel = models.find((m) => m.id === selectedModelId);

  if (!selectedModel) {
    p.log.error("Model not found");
    return null;
  }

  // Check if the model can run on this system
  const { totalRAM } = await ModelManager.checkSystemCapabilities();
  const recommendation = ModelManager.canModelRunOnSystem(
    selectedModel,
    totalRAM,
  );

  if (recommendation) {
    p.log.warning(recommendation);
    const forceContinue = await p.confirm({
      message: "Do you want to continue anyway?",
    });

    if (p.isCancel(forceContinue) || !forceContinue) {
      p.cancel("Operation cancelled");
      return null;
    }
  }

  if (!selectedModel.isDownloaded) {
    const shouldDownload = await p.confirm({
      message: `${selectedModel.name} (${selectedModel.size}) is not downloaded. Download now?`,
    });

    if (p.isCancel(shouldDownload) || !shouldDownload) {
      p.cancel("Download cancelled");
      return null;
    }

    p.log.info(
      `Starting download of ${selectedModel.name} (${selectedModel.size})...`,
    );

    const spinner = p.spinner();
    spinner.start(
      `Downloading ${selectedModel.name} (${selectedModel.size})...`,
    );

    // Track download progress
    const success = await ModelManager.downloadModel(
      selectedModel,
      (progress) => {
        // Use the DownloadManager's renderProgressBar method to format the progress
        const progressBar = DownloadManager.renderProgressBar(progress);
        spinner.message(`Downloading ${selectedModel.name}... ${progressBar}`);
      },
    );

    spinner.stop(
      success
        ? `Downloaded ${selectedModel.name} successfully!`
        : `Failed to download ${selectedModel.name}`,
    );

    if (!success) {
      return null;
    }
  }

  return selectedModel;
}

/**
 * Create the local command
 * @returns The local command
 */
export function createLocalCommand(): Command {
  const localCommand = new Command("local")
    .alias("model")
    .alias("models")
    .description("Manage local AI models")
    .action(async () => {
      p.intro("BashBuddy Local AI Model Management");

      // Check system capabilities first
      const { totalRAM, hardwareAcceleration } =
        await ModelManager.checkSystemCapabilities();

      // Check if any hardware acceleration is available
      const hasHardwareAcceleration = hardwareAcceleration.some(
        (acc) => acc.available && acc.type !== "none",
      );

      // Only show hardware acceleration warning if none is available
      if (!hasHardwareAcceleration) {
        // Create a more eye-catching warning message
        const warningTitle = chalk.bgYellow.black.bold(
          " ⚠️  HARDWARE ACCELERATION WARNING ⚠️ ",
        );

        let warningMessage = "";

        // Hardware acceleration warning
        warningMessage += chalk.yellow.bold(
          `\n⚠️  HARDWARE ACCELERATION ISSUE: No GPU acceleration detected!`,
        );
        warningMessage += chalk.yellow(
          `\n   Running models on CPU only will be significantly slower.`,
        );
        warningMessage += chalk.yellow(
          `\n   For optimal performance, a compatible GPU with CUDA, Metal, or Vulkan support is recommended.`,
        );

        // Display the warning box
        p.log.warning("\n" + warningTitle);
        p.log.warning(warningMessage + "\n");
      } else {
        // Show available acceleration
        const availableAccelerations = hardwareAcceleration
          .filter((acc) => acc.available && acc.type !== "none")
          .map((acc) => acc.details ?? acc.type)
          .join(", ");

        p.log.success(`Hardware Acceleration: ${availableAccelerations}`);
      }

      // Show RAM information
      p.log.info(`System RAM: ${totalRAM} GB total`);

      const model = await selectModel();
      if (!model) {
        p.outro("Exiting local AI model management");
        return;
      }

      await ConfigManager.saveLocalModel(model.id);
      await ConfigManager.setMode(LOCAL_MODE);

      p.log.success(`Selected model: ${model.name}`);
      p.log.info(`Model size: ${model.size}`);
      p.log.info(`Model path: ${model.filePath}`);

      p.outro("Local AI model management complete");
    });

  return localCommand;
}
