import { Types } from '@graphql-codegen/plugin-helpers';
import {
  ClientSideBasePluginConfig,
  ClientSideBaseVisitor,
  DocumentMode,
  getConfigValue,
  LoadedFragment,
} from '@graphql-codegen/visitor-plugin-common';
import autoBind from 'auto-bind';
import { lowerCaseFirst, pascalCase } from 'change-case-all';
import { GraphQLField, GraphQLSchema, OperationDefinitionNode } from 'graphql';
import { ReactQueryRawPluginConfig } from './config';
import { CustomMapperFetcher } from './fetcher-custom-mapper';
import { FetcherRenderer } from './fetcher-renderer';
import { generateMutationKeyMaker, generateQueryKeyMaker } from './key-maker';
import { generateInputTransformer, generateOutputTransformer } from './transformer';
import { getInputVariablesType, getOutputType } from './type-resolver';

export interface ReactQueryPluginConfig extends ClientSideBasePluginConfig {
  errorType: string;
  exposeDocument: boolean;
  exposeQueryKeys: boolean;
  exposeMutationKeys: boolean;
  exposeFetcher: boolean;
  addInfiniteQuery: boolean;
}

export interface ReactQueryMethodMap {
  infiniteQuery: {
    hook: string;
    options: string;
  };
  query: {
    hook: string;
    options: string;
  };
  mutation: {
    hook: string;
    options: string;
  };
}

export class ReactQueryVisitor extends ClientSideBaseVisitor<ReactQueryRawPluginConfig, ReactQueryPluginConfig> {
  private _externalImportPrefix: string;
  public fetcher: FetcherRenderer;
  public reactQueryHookIdentifiersInUse = new Set<string>();
  public reactQueryOptionsIdentifiersInUse = new Set<string>();
  public fields: Record<string, GraphQLField<any, any>>;

  public queryMethodMap: ReactQueryMethodMap = {
    infiniteQuery: {
      hook: 'useInfiniteQuery',
      options: 'UseInfiniteQueryOptions',
    },
    query: {
      hook: 'useQuery',
      options: 'UseQueryOptions',
    },
    mutation: {
      hook: 'useMutation',
      options: 'UseMutationOptions',
    },
  };

  constructor(
    schema: GraphQLSchema,
    fragments: LoadedFragment[],
    protected rawConfig: ReactQueryRawPluginConfig,
    documents: Types.DocumentFile[],
  ) {
    super(schema, fragments, rawConfig, {
      documentMode: DocumentMode.string,
      errorType: getConfigValue(rawConfig.errorType, 'unknown'),
      exposeDocument: getConfigValue(rawConfig.exposeDocument, false),
      exposeQueryKeys: getConfigValue(rawConfig.exposeQueryKeys, false),
      exposeMutationKeys: getConfigValue(rawConfig.exposeMutationKeys, false),
      exposeFetcher: getConfigValue(rawConfig.exposeFetcher, false),
      addInfiniteQuery: getConfigValue(rawConfig.addInfiniteQuery, false),
    });
    this._externalImportPrefix = this.config.importOperationTypesFrom ? `${this.config.importOperationTypesFrom}.` : '';
    this._documents = documents;
    this.fetcher = this.createFetcher(rawConfig.fetcher || 'fetch');

    this.fields = { ...this._schema.getQueryType()?.getFields(), ...this._schema.getMutationType()?.getFields() };

    autoBind(this);
  }

  public get imports(): Set<string> {
    return this._imports;
  }

  private createFetcher(raw: ReactQueryRawPluginConfig['fetcher']): FetcherRenderer {
    return new CustomMapperFetcher(this, raw);
  }

  public get hasOperations() {
    return this._collectedOperations.length > 0;
  }

  public getImports(): string[] {
    const baseImports = super.getImports();

    if (!this.hasOperations) {
      return baseImports;
    }

    if (this.config.addInfiniteQuery) {
      this.reactQueryOptionsIdentifiersInUse.add('QueryFunctionContext');
    }

    const hookAndTypeImports = [
      ...Array.from(this.reactQueryHookIdentifiersInUse),
      ...Array.from(this.reactQueryOptionsIdentifiersInUse).map(
        (identifier) => `${this.config.useTypeImports ? 'type ' : ''}${identifier}`,
      ),
    ];

    return [...baseImports, `import { ${hookAndTypeImports.join(', ')} } from 'react-query';`];
  }

  public getFetcherImplementation(): string {
    return this.fetcher.generateFetcherImplementaion();
  }

  private _getHookSuffix(name: string, operationType: string) {
    if (this.config.omitOperationSuffix) {
      return '';
    }
    if (!this.config.dedupeOperationSuffix) {
      return pascalCase(operationType);
    }
    if (name.includes('Query') || name.includes('Mutation') || name.includes('Subscription')) {
      return '';
    }
    return pascalCase(operationType);
  }

  protected buildOperation(
    node: OperationDefinitionNode,
    documentVariableName: string,
    operationType: string,
    operationResultType: string,
    operationVariablesTypes: string,
    hasRequiredVariables: boolean,
  ): string {
    const nodeName = node.name?.value ?? '';
    const suffix = this._getHookSuffix(nodeName, operationType);
    const operationName: string = this.convertName(nodeName, {
      suffix,
      useTypesPrefix: false,
      useTypesSuffix: false,
    });

    operationResultType = this._externalImportPrefix + operationResultType;
    operationVariablesTypes = this._externalImportPrefix + operationVariablesTypes;

    const fieldName = lowerCaseFirst(nodeName); // createNode, getNode, ...
    const fieldDefinition = this.fields[fieldName];

    const outputType = getOutputType(fieldDefinition);
    const outputResultType = outputType.typeName;
    const variablesType = getInputVariablesType(fieldDefinition);
    const inputVariablesType = operationVariablesTypes;

    let query = '';

    if (operationType === 'Query') {
      query += generateQueryKeyMaker(node, operationName, operationVariablesTypes, hasRequiredVariables);
      query += generateInputTransformer(
        node,
        operationName,
        operationVariablesTypes,
        operationResultType,
        hasRequiredVariables,
        variablesType,
      );
      query += generateOutputTransformer(
        node,
        operationName,
        operationVariablesTypes,
        operationResultType,
        hasRequiredVariables,
        outputType,
      );
      query += this.fetcher.generateFetcherFetch(
        node,
        documentVariableName,
        operationName,
        operationResultType,
        operationVariablesTypes,
        hasRequiredVariables,
        outputResultType,
        inputVariablesType,
      );
    } else if (operationType === 'Mutation') {
      query += generateMutationKeyMaker(node, operationName);
      query += generateInputTransformer(
        node,
        operationName,
        operationVariablesTypes,
        operationResultType,
        hasRequiredVariables,
        variablesType,
      );
      query += generateOutputTransformer(
        node,
        operationName,
        operationVariablesTypes,
        operationResultType,
        hasRequiredVariables,
        outputType,
      );
      query += this.fetcher.generateFetcherFetch(
        node,
        documentVariableName,
        operationName,
        operationResultType,
        operationVariablesTypes,
        hasRequiredVariables,
        outputResultType,
        inputVariablesType,
      );
    } else if (operationType === 'Subscription') {
      // not supported yet
    }

    return query;
  }
}
