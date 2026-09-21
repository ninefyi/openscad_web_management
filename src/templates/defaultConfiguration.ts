import type { Configuration, Template } from "../types/template";

export function defaultConfiguration(template: Template): Configuration {
  const config: Configuration = {};
  for (const param of template.parameters) {
    config[param.name] = param.defaultValue;
  }
  return config;
}
