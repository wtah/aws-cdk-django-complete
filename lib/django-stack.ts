import * as cdk from 'aws-cdk-lib';
import {StackProps, aws_ec2} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {BuildConfig} from './get-config';
import {DjangoDB} from './constructs/django-db';
import {DjangoECS} from './constructs/django-ecs';
import {NagSuppressions} from "cdk-nag";


export class DjangoStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StackProps, buildConfig: BuildConfig) {
        super(scope, id, props);

     const prefix = this.node.tryGetContext('prefix');
     const environment= prefix == 'prod' ? 'prod' : 'dev';

     const vpc = new aws_ec2.Vpc(this, `${environment}-base-vpc`, {
            ipAddresses: aws_ec2.IpAddresses.cidr("172.20.0.0/16"),
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [
                {
                    cidrMask: 16,
                    name: 'public',
                    subnetType: aws_ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 16,
                    name: 'private',
                    subnetType: aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            ],
        })

        vpc.addFlowLog('vpc-flow-logs')

        const vpcSecurityGroup = new aws_ec2.SecurityGroup(this, `${environment}-vpc-sg`, {
            //securityGroupName: 'app-vpn-sg',
            vpc: vpc,
            //description: 'Allow Client Connections',
            allowAllOutbound: true
        })

        const vpnCertificateArn = buildConfig.Parameters.SERVER_CERT_ARN;


        vpcSecurityGroup.addIngressRule(vpcSecurityGroup, aws_ec2.Port.allTraffic(), 'Allow All Traffic within SG');

        //Create the Client VPN Endpoint with Mutual Authentication
        const cfnClientVpnEndpoint = new aws_ec2.CfnClientVpnEndpoint(this, `${environment}-cfn-client-vpn-endpoint`, {
            authenticationOptions: [{
                type: 'certificate-authentication',
                mutualAuthentication: {
                    clientRootCertificateChainArn: vpnCertificateArn,
                },
            }],
            clientCidrBlock: '10.0.0.0/16',
            connectionLogOptions: {
                enabled: false,
            },
            serverCertificateArn: vpnCertificateArn,
            description: 'VPN for connecting Private subnets',
            securityGroupIds: [vpcSecurityGroup.securityGroupId],
            sessionTimeoutHours: 12,
            tagSpecifications: [{
                resourceType: 'client-vpn-endpoint',
                tags: [{
                    key: 'Name',
                    value: `${environment}-vpn-endpoint`,
                }],
            }],
            dnsServers: ['169.254.169.253', '172.20.0.2'],
            splitTunnel: true,
            vpcId: vpc.vpcId,
            transportProtocol: 'tcp',
        });

        //Add Authorization Rules to grant access to VPC
        const demoVpnAuthorizationRule = new aws_ec2.CfnClientVpnAuthorizationRule(this, `${environment}-vpn-authorization-rule`, {
            clientVpnEndpointId: cfnClientVpnEndpoint.ref,
            targetNetworkCidr: vpc.vpcCidrBlock,
            authorizeAllGroups: true
        });

        //Add Network associations to configure Private subnet routes and associations
        for (const subnet of vpc.privateSubnets) {
            new aws_ec2.CfnClientVpnTargetNetworkAssociation(this, `${environment}-network-association` + subnet, {
                clientVpnEndpointId: cfnClientVpnEndpoint.ref,
                subnetId: subnet.subnetId,
            });
        }


        const djangoDB = new DjangoDB(this, `${environment}-django-db`, {
            vpc: vpc,
            vpcSecurityGroup: vpcSecurityGroup,
            environment: environment,
            prefix: prefix
        }, buildConfig)

        new DjangoECS(this, `${prefix}-django-ecs`, {
            vpc: vpc,
            dbSecurityGroup: djangoDB.vpcSecurityGroup,
            dbCluster: djangoDB.dbCluster,
            environment: environment,
            prefix: prefix
        }, buildConfig)

        NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Simplicity for sample purposes'
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Simplicity for sample purposes'
            },
        ])

    }
}
