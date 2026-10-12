import { gql } from '@apollo/client';

export const HOME_RELIABILITY_FIELDS = gql`
  fragment HomeReliabilityFields on HomeReliability {
    asOf connectionState checkStatus firstObservedAt lastHeardAt checkedAt checkReason
    checksVerified checksFailed checksInconclusive
    windows { label connectedSeconds offlineSeconds unknownSeconds coveragePercent availabilityPercent }
    timeline { bucketStart connectedSeconds offlineSeconds unknownSeconds checksVerified checksFailed checksInconclusive }
    interruptions { startedAt endedAt durationSeconds }
  }
`;
