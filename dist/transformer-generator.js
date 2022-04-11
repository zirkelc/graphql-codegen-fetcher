"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInputTransformer = exports.generateOutputTransformer = exports.generateQueryVariablesSignature = void 0;
function generateQueryVariablesSignature(hasRequiredVariables, operationVariablesTypes) {
    return `variables${hasRequiredVariables ? '' : '?'}: ${operationVariablesTypes}`;
}
exports.generateQueryVariablesSignature = generateQueryVariablesSignature;
function generateOutputTransformer(node, operationName, operationVariablesTypes, operationResultType, hasRequiredVariables, outputType) {
    const { fieldName, fields } = outputType;
    const comment = `\n/**
  * Output transformer function for \`${operationName}\`.
  * It extracts the \`${fieldName}\` field from the result and transforms it into a \`${outputType.typeName}\` object.
  * If the object contains JSON fields, it will automatically JSON parse these fields and return a new object.
  * If the object does not conatain any JSON fields, it will return the orignal object.
  * @param data ${operationResultType} - The data returned from the GraphQL server
  * @returns ${outputType.typeName} - The transformed data
  */`;
    const implementation = `export const ${operationName}Output = ({ ${fieldName} }: ${operationResultType}) => ${hasJsonFields(outputType.fields)
        ? `${fieldName} && ({...${fieldName}, ${transformJsonFields(fields, `${fieldName}`, 'parse').join('\n')} }) as ${outputType.typeName}`
        : `${fieldName} as ${outputType.typeName}`};`;
    return `\n${comment}\n${implementation}`;
}
exports.generateOutputTransformer = generateOutputTransformer;
function generateInputTransformer(node, operationName, operationVariablesTypes, operationResultType, hasRequiredVariables, variablesType) {
    const signature = generateQueryVariablesSignature(hasRequiredVariables, operationVariablesTypes);
    const hasVariables = variablesType && Object.keys(variablesType).length > 0;
    const hasJson = Object.keys(variablesType).some((field) => hasJsonFields(variablesType[field].fields));
    const comment = `\n/**
  * Input transformer function for \`${operationName}\`.
  * It transforms the fields of the variables into JSON strings.
  * If the variables contain JSON fields, it will automatically JSON stringify these fields and return a new \`variables\` object.
  * If the variables do not conatain any JSON fields, it will return the orignal \`variables\` object.
  * If no variables are defined, the function returns \`undefined\`.
  * ${hasVariables ? `@param variables \`${operationVariablesTypes}\` - The original variables` : ''}
  * ${hasVariables ? `@returns \`${operationVariablesTypes}\` - The transformed variables` : '@returns `undefined`'}
  */`;
    const implementation = hasVariables
        ? `export const ${operationName}Input = (${signature}) => ${hasJson
            ? `({...variables, ${Object.keys(variablesType)
                .filter((field) => hasJsonFields(variablesType[field].fields))
                .map((field) => `${field}: { ${transformJsonFields(variablesType[field].fields || {}, `variables.${field}`, 'stringify')} },`)
                .join('\n')} }) as ${operationVariablesTypes}`
            : `variables as ${operationVariablesTypes}`};`
        : `export const ${operationName}Input = () => undefined;`;
    return `\n${comment}\n${implementation}`;
}
exports.generateInputTransformer = generateInputTransformer;
const transformJsonFields = (fields, path, transformer) => {
    const stack = [];
    for (const [field, fieldValue] of Object.entries(fields)) {
        let fieldName = field;
        const isMandatory = field.includes('!');
        fieldName = isMandatory ? fieldName.substring(0, fieldName.length - 1) : fieldName;
        const isArray = field.includes('[]');
        fieldName = isArray ? fieldName.substring(0, fieldName.length - 2) : fieldName;
        const fieldNameSingular = fieldName.substring(0, fieldName.length - 1);
        const fieldPath = `${path}.${fieldName}`;
        if (fieldValue && typeof fieldValue === 'object') {
            if (isArray) {
                stack.push(`${fieldName}: ${fieldPath}?.map((${fieldNameSingular}) => ({`, `...${fieldNameSingular},`, ...transformJsonFields(fieldValue, fieldNameSingular + '?', transformer), `})),`);
            }
            else {
                stack.push(`${fieldName}: {`, `...${fieldPath},`, ...transformJsonFields(fieldValue, fieldPath + '?', transformer), `},`);
            }
        }
        else {
            if (fieldValue === 'AWSJSON') {
                transformer === 'parse' &&
                    stack.push(`${fieldName}: ${fieldPath} && JSON.parse(${fieldPath} as unknown as string),`);
                transformer === 'stringify' &&
                    stack.push(`${fieldName}: ${fieldPath} && JSON.stringify(${fieldPath} as unknown as Record<string, any>),`);
            }
        }
    }
    return stack;
};
const hasJsonFields = (fields) => {
    if (!fields)
        return false;
    return (Object.entries(fields)
        .map(([, fieldValue]) => {
        if (fieldValue && typeof fieldValue === 'object') {
            return hasJsonFields(fieldValue);
        }
        else {
            return fieldValue === 'AWSJSON';
        }
    })
        .filter(Boolean).length > 0);
};
//# sourceMappingURL=transformer-generator.js.map