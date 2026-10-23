import {
  createCodeFixActionWithoutFixAll,
  registerCodeFix,
  setJsonCompilerOptionValue,
} from "../_namespaces/ts.codefix.js";
import {
  Diagnostics,
  factory,
  flattenDiagnosticMessageText,
  formatStringFromArgs,
  getLocaleSpecificMessage,
  textChanges,
  tsppFeatureDefinitions,
} from "../_namespaces/ts.js";

const fixId = "enableTsppFeature";
const errorCodes = [Diagnostics.TS_feature_0_is_not_enabled_in_tsppconfig_json.code];

registerCodeFix({
  errorCodes,
  getCodeActions(context) {
    const options = context.program.getCompilerOptions();
    const configFile = options.configFile;
    if (!configFile) return undefined;

    const diagnostics = context.program.getSemanticDiagnostics(context.sourceFile).filter(candidate =>
      candidate.code === context.errorCode &&
      candidate.start === context.span.start &&
      candidate.length === context.span.length
    );
    const requested = tsppFeatureDefinitions.filter(definition => diagnostics.some(diagnostic => formatStringFromArgs(getLocaleSpecificMessage(Diagnostics.TS_feature_0_is_not_enabled_in_tsppconfig_json), [definition.name]) === flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).map(definition => definition.name);
    if (!requested.length) return undefined;

    let features: readonly string[] = options.tsppFeatures ?? [];
    for (const feature of requested) features = collectFeaturesWithDependencies(features, feature);
    const changes = textChanges.ChangeTracker.with(context, changeTracker => {
      setJsonCompilerOptionValue(
        changeTracker,
        configFile,
        "tsppFeatures",
        factory.createArrayLiteralExpression(features.map(name => factory.createStringLiteral(name)), /*multiLine*/ true),
      );
    });
    return [
      requested.length === 1
        ? createCodeFixActionWithoutFixAll(fixId, changes, [Diagnostics.Enable_TS_feature_0_and_its_required_dependencies, requested[0]])
        : createCodeFixActionWithoutFixAll(fixId, changes, Diagnostics.Enable_missing_TS_features_and_their_required_dependencies),
    ];
  },
});

function collectFeaturesWithDependencies(existing: readonly string[], requested: string): readonly string[] {
  const result = [...existing];
  const seen = new Set(existing);
  const add = (feature: string): void => {
    if (seen.has(feature)) return;
    const definition = tsppFeatureDefinitions.find(candidate => candidate.name === feature);
    if (!definition) return;
    for (const dependency of definition.dependencies) add(dependency);
    seen.add(feature);
    result.push(feature);
  };
  add(requested);
  return result;
}
