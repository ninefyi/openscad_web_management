export type ControlType =
  | "slider"
  | "number"
  | "dropdown"
  | "checkbox"
  | "text"
  | "color";

export type ParameterValue = number | string | boolean | number[];

export interface ParameterBase {
  name: string;
  label: string;
  group: string;
  hidden: boolean;
  annotated: boolean;
  defaultValue: ParameterValue;
}

export interface SliderParameter extends ParameterBase {
  control: "slider";
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface NumberParameter extends ParameterBase {
  control: "number";
  defaultValue: number;
}

export interface DropdownParameter extends ParameterBase {
  control: "dropdown";
  options: { value: string; label: string }[];
  defaultValue: string;
}

export interface CheckboxParameter extends ParameterBase {
  control: "checkbox";
  defaultValue: boolean;
}

export interface TextParameter extends ParameterBase {
  control: "text";
  defaultValue: string;
}

export interface ColorParameter extends ParameterBase {
  control: "color";
  defaultValue: number[];
}

export type Parameter =
  | SliderParameter
  | NumberParameter
  | DropdownParameter
  | CheckboxParameter
  | TextParameter
  | ColorParameter;

/** The current set of Parameter values a user has dialed in during the active session. */
export type Configuration = Record<string, ParameterValue>;

export interface Template {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  source: string;
  parameters: Parameter[];
  kind: "builtin" | "uploaded";
}
