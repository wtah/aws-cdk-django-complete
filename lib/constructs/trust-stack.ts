import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import {BuildConfig} from "../get-config";
import {NagSuppressions} from "cdk-nag";


// You can use the AWS CDK CLI to deploy this stack with the following command:
// cdk deploy --parameters GitHubOrg=<org> --parameters GitHubRepo=<repo>
export class TrustStack extends cdk.Stack {
 constructor(scope: Construct, id: string, props: cdk.StackProps, buildConfig: BuildConfig) {
   super(scope, id, props);



   // -- Defines an OpenID Connect (OIDC) provider for GitHub Actions. --
   // This provider will be used by the GitHub Actions workflow to
   // assume a role which can be used to deploy the CDK application.
   const githubProvider = new iam.CfnOIDCProvider(this, "GitHubOIDCProvider", {
     thumbprintList: ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"],
     url: "https://token.actions.githubusercontent.com", // <-- 1 per account
     clientIdList: ["sts.amazonaws.com"], // <-- Tokens are intended for STS
   });
   // See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services#adding-the-identity-provider-to-aws
   // Thumbprint from: https://github.blog/changelog/2022-01-13-github-actions-update-on-oidc-based-deployments-to-aws/
   //    ^--- This value can be calculated, but it won't change regularly.
   //         You can also retrieve by providing starting the provider
   //         creation process in the AWS Console and using the
   //         "Get thumbprint" button after selecting OpenID Connect
   //         as the type and inputting the provider URL.

   // dummy comment
   // -- Defines a role that can be assumed by GitHub Actions. --
   // This role will be used by the GitHub Actions workflow to deploy the stack.
   // It is assumable only by GitHub Actions running against the `main` branch
   const githubActionsRole = new iam.Role(this, "GitHubActionsRole", {
     assumedBy: new iam.FederatedPrincipal(
       githubProvider.attrArn,
       {
         StringLike: {
           // This specifies that the subscriber (sub) claim must be the main
           // branch of your repository. You can use wildcards here, but
           // you should be careful about what you allow.
           "token.actions.githubusercontent.com:sub": [
             `repo:${buildConfig.Parameters.GITHUB_ORG}/${buildConfig.Parameters.GITHUB_REPO}:ref:refs/heads/*`,
           ],
         },
         // This specifies that the audience (aud) claim must be sts.amazonaws.com
         StringEquals: {
           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
         },
       },
       "sts:AssumeRoleWithWebIdentity" // <-- Allows use of OIDC identity
     ),
   });


   // -- A policy to permit assumption of the default AWS CDK roles. --
   // Allows assuming roles tagged with an aws-cdk:bootstrap-role tag of
   // certain values (file-publishing, lookup, deploy) which permit the CDK
   // application to look up existing values, publish assets, and create
   // CloudFormation changesets. These roles are created by CDK's
   // bootstrapping process. See:
   // https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html
   //
   // WARNING: The CDK `deploy` role allows the CDK to execute changes via
   //          CloudFormation with its execution role. The execution role
   //          has full administrative permissions. It can only be assumed
   //          by CloudFormation, but you should still be aware.
     const assumeCdkDeploymentRoles = new iam.PolicyStatement({
     effect: iam.Effect.ALLOW,
     actions: ["sts:AssumeRole"],
     resources: [githubActionsRole.roleArn],
     conditions: {
       StringEquals: {
         "aws:ResourceTag/aws-cdk:bootstrap-role": [
           "file-publishing",
           "lookup",
           "deploy",
         ],
       },
     },
   });


   // Add the policy statement to the GitHub Actions role so it can actually
   // assume the CDK deployment roles it will require.
   githubActionsRole.addToPolicy(assumeCdkDeploymentRoles);


    // Additional policy to allow needed resource access
    const ec2DescribeAZPermission = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ec2:DescribeAvailabilityZones",
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          "cloudformation:DeleteChangeSet",
          "ssm:GetParameter",
          "ecr:*", // Less restrictive than possible
          "s3:*", // Less restrictive than possible
          "iam:PassRole"
      ],
      resources: ["*"], // This action doesn't support resource-level permissions
    });
    githubActionsRole.addToPolicy(ec2DescribeAZPermission);


    // Here's where we add the Nag suppression for the AwsSolutions-IAM5 warning
    NagSuppressions.addResourceSuppressions(
      githubActionsRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The policy requires wildcard permissions to enable broad access for CDK deployment roles and EC2 availability zone descriptions, as per the design.'
        }
      ],
      true // Recursively apply this suppression to all children of the GitHubActionsRole, if any.
    );



   new cdk.CfnOutput(this, "GitHubActionsRoleArn", {
     value: githubActionsRole.roleArn,
     description: (
       "The role ARN for GitHub Actions to use during deployment."
     )
   });
 }
}