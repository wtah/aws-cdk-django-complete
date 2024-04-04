import { aws_ec2, aws_rds, aws_kms, aws_logs, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DBInitializer } from "./db-initializer";
import { Credentials } from "aws-cdk-lib/aws-rds";
import { NagSuppressions } from "cdk-nag";
import {BuildConfig} from "../get-config";


export interface DjangoDBProps {
    readonly vpc: aws_ec2.Vpc;
    readonly vpcSecurityGroup: aws_ec2.SecurityGroup;
}

export class DjangoDB extends Construct {
    constructor(scope: Construct, id: string, props: DjangoDBProps, buildConfig: BuildConfig) {
        super(scope, id);

        const dbKey = new aws_kms.Key(this, 'django-db-key',
            {
                alias: 'django-db-key',
                enableKeyRotation: true
            })

        const dbCredentials = new aws_rds.DatabaseSecret(this, 'database-credentials', {
            username: 'admin',

        })
        NagSuppressions.addResourceSuppressions(dbCredentials, [
            {
                id: 'AwsSolutions-SMG4',
                reason: 'Rotation disabled to avoid complexity for sample purposes.'
            },
        ])

        const dbServerless = new aws_rds.DatabaseCluster(this, 'Database', {
            engine: aws_rds.DatabaseClusterEngine.auroraMysql({ version: aws_rds.AuroraMysqlEngineVersion.VER_3_03_1 }),
            writer: aws_rds.ClusterInstance.serverlessV2('writer', {
                allowMajorVersionUpgrade: true,
                enablePerformanceInsights: true,
                performanceInsightEncryptionKey: dbKey,
            }),
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: 2,
            readers: [
                aws_rds.ClusterInstance.serverlessV2('reader1', {
                    scaleWithWriter: true,
                    allowMajorVersionUpgrade: true,
                    enablePerformanceInsights: true,
                    performanceInsightEncryptionKey: dbKey
                }),
            ],
            vpc: props.vpc,
            iamAuthentication: true,
            storageEncryptionKey: dbKey,
            defaultDatabaseName: 'main',
            credentials: Credentials.fromSecret(dbCredentials),
            securityGroups: [props.vpcSecurityGroup],
            cloudwatchLogsExports: [
                'general',
                'error',
                'audit',
            ],
            cloudwatchLogsRetention: aws_logs.RetentionDays.ONE_MONTH
        });
        NagSuppressions.addResourceSuppressions(dbServerless, [
            {
                id: 'AwsSolutions-RDS10',
                reason: 'Deletion protection disabled for easier cleanup of the sample.'
            },
            {
                id: 'AwsSolutions-RDS11',
                reason: 'Default port as for sample purposes'
            },
            {
                id: 'AwsSolutions-RDS14',
                reason: 'No Backtrack as for sample purposes'
            },
        ])

        const initializer = new DBInitializer(this, 'DjangoDBInit', {
            dbConfigSecret: dbServerless.secret?.secretName!,
            vpc: props.vpc
        })

        props.vpcSecurityGroup.addIngressRule(initializer.fnSecurityGroup, aws_ec2.Port.tcp(3306))
        // Modify the existing VPC Security Group to allow ingress from the VPN client CIDR block
        props.vpcSecurityGroup.addIngressRule(aws_ec2.Peer.ipv4('10.0.0.0/16'), aws_ec2.Port.tcp(3306), 'Allow MySQL connections from VPN clients');
        dbCredentials.grantRead(initializer.function)
        initializer.function.executeAfter(dbServerless)

        this.vpcSecurityGroup = props.vpcSecurityGroup
        this.dbCluster = dbServerless
    }

    vpcSecurityGroup: aws_ec2.SecurityGroup
    dbCluster: aws_rds.DatabaseCluster
}