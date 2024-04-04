#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {AwsSolutionsChecks} from 'cdk-nag'
import {Aspects} from 'aws-cdk-lib';
import {BuildConfig, getConfig} from '../lib/get-config';
import {DjangoStack} from '../lib/django-stack';
import {TrustStack} from "../lib/constructs/trust-stack";

const app = new cdk.App();

let buildConfig: BuildConfig = getConfig();

// Retrieve the prefix from the context parameters
let prefix = app.node.tryGetContext('prefix') ?? 'demo';
const environment = prefix == 'prod' ? 'prod' : 'dev';

const accountEnv =
    {
        region: buildConfig.Parameters.REGION,
        account: buildConfig.Parameters.ACCOUNT_ID,
    };

new TrustStack(app, "TrustStack", {
    env: accountEnv,
}, buildConfig);

new DjangoStack(app, `${prefix}-DjangoStack`, {
    env: accountEnv,
}, buildConfig);

Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}))
