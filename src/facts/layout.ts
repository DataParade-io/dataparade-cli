import path from "path";

/** Default folder a scan writes into, relative to the current directory. */
export const DEFAULT_OUTPUT_DIRNAME = ".dataparade";
/** Default path of the diagram file (`-o/--output`). */
export const DEFAULT_DATAFLOW_OUTPUT = path.join(DEFAULT_OUTPUT_DIRNAME, "dataflow.json");

export const DATAFLOW_BASENAME = "dataflow.json";
export const FACTS_BASENAME = "facts.json";
export const DATA_ITEMS_DIRNAME = "data-items";
export const GRAPHIFY_BASENAME = "graphify.json";
export const ANSWERS_BASENAME = "answers.json";

/** Every file and folder a scan or `dataparade kb` keeps in the output folder. */
export interface OutputLayout {
  /** The output folder, i.e. the folder that holds dataflow.json. */
  dir: string;
  dataflowPath: string;
  factsPath: string;
  dataItemsDir: string;
  graphifyPath: string;
  answersPath: string;
  /** Interview briefs (`dataparade kb brief`). */
  briefsDir: string;
  /** Unedited interview transcripts. */
  evidenceDir: string;
  /** Latest diagram projection (`dataparade kb project`). */
  diagramPath: string;
}

/** `-o/--output` names dataflow.json; every other file sits next to it. */
export function resolveOutputLayout(dataflowOutputPath: string): OutputLayout {
  const dataflowPath = path.resolve(dataflowOutputPath);
  return layoutForDir(path.dirname(dataflowPath), dataflowPath);
}

/** The layout for an output folder (the folder that holds dataflow.json). */
export function layoutForDir(dir: string, dataflowPath?: string): OutputLayout {
  const root = path.resolve(dir);
  return {
    dir: root,
    dataflowPath: dataflowPath ?? path.join(root, DATAFLOW_BASENAME),
    factsPath: path.join(root, FACTS_BASENAME),
    dataItemsDir: path.join(root, DATA_ITEMS_DIRNAME),
    graphifyPath: path.join(root, GRAPHIFY_BASENAME),
    answersPath: path.join(root, ANSWERS_BASENAME),
    briefsDir: path.join(root, "briefs"),
    evidenceDir: path.join(root, "evidence"),
    diagramPath: path.join(root, "diagram.json"),
  };
}
