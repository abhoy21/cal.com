import type { DirectorySyncEvent } from "@boxyhq/saml-jackson";

import { DIRECTORY_IDS_TO_LOG } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";

const log = logger.getSubLogger({ prefix: ["getAttributesFromScimPayload"] });

type ScimUserAttributeName = string;
type ScimUserAttributeValue = string | string[];
const coreSchemaUrn = "urn:ietf:params:scim:schemas:core:2.0:User";
//It avoids unnecessary warnings about attributes not defined in cal.com
const coreUserAttributesToIgnore = [
  "userName",
  "name",
  "displayName",
  "emails",
  "active",
  "externalId",
  "id",
  "groups",
  "meta",
  "locale",
  "password",
  "phoneNumbers",
  "photos",
  "profileUrl",
  "timezone",
  "title",
  "addresses",
  "entitlements",
  "ims",
  "roles",
  "x509Certificates",
];

/**
 * event.data.raw has this format
 * {
 *   "schemas": [
 *     "urn:ietf:params:scim:schemas:core:2.0:User",
 *     "segment",
 *     "territory"
 *   ],
 *   "userName": "member@samldemo.com",
 *   "name": {
 *     "givenName": "Member SAML Demo",
 *     "familyName": "Member SAML Demo"
 *   },
 *   "emails": [
 *     {
 *       "primary": true,
 *       "value": "member@samldemo.com"
 *     }
 *   ],
 *   "displayName": "Member SAML Demo",
 *   "territory": {
 *     "territory": "NAM"
 *   },
 *   "segment": {
 *     "segment": "SMB"
 *   },
 *   "externalId": "00ukzk1wrsKZqofit5d7",
 *   "groups": [],
 *   "active": true,
 *   "id": "b36ba9fa-783b-44e6-a770-a652cb9d71ba"
 * }
 *
 * Transforms above to
 * {
 *   "territory": "NAM",
 *   "segment": "SMB"
 * }
 */
function getAttributesFromScimPayload({
  event,
  directoryId,
}: {
  event: DirectorySyncEvent;
  directoryId: string;
}): Record<ScimUserAttributeName, ScimUserAttributeValue> {
  const scimUserAttributes: Record<ScimUserAttributeName, ScimUserAttributeValue> = {};

  if (event.event !== "user.created" && event.event !== "user.updated") {
    log.error("getAttributesFromScimPayload", `Unsupported event: ${event.event}`);
    return scimUserAttributes;
  }

  const raw = event.data.raw;
  raw.schemas.forEach((schema: unknown) => {
    if (schema === coreSchemaUrn) {
      // Core schema has payload in the root
      const { schemas: _schemas, ...namespaceData } = raw;

      collectAttributes({ data: namespaceData, ignoreList: coreUserAttributesToIgnore });
      return;
    }
    const namespaceName = schema;
    if (typeof namespaceName !== "string") {
      log.error(
        "getAttributesFromScimPayload",
        `Namespace name is not a string ${safeStringify(namespaceName)}`
      );
      return;
    }
    const namespaceData = raw[namespaceName];
    if (!namespaceData) {
      log.warn("getAttributesFromScimPayload", `Namespace data for ${namespaceName} is null. Ignoring it.`);
      return;
    }

    collectAttributes({ data: namespaceData });
  });

  const shouldLog = DIRECTORY_IDS_TO_LOG.includes(directoryId);
  if (shouldLog) {
    console.log("Collected Attributes:", `${safeStringify(scimUserAttributes)}`);
  }

  return scimUserAttributes;

  function collectAttributes({
    data,
    ignoreList = [],
  }: {
    data: Record<string, unknown>;
    ignoreList?: string[];
  }) {
    Object.entries(data).forEach(([customAttributeName, value]) => {
      if (ignoreList.includes(customAttributeName)) {
        return;
      }
      if (!value) {
        log.warn(
          "getAttributesFromScimPayload",
          `Custom attribute ${customAttributeName} is null. Ignoring it.`
        );
        return;
      }
      if (scimUserAttributes[customAttributeName]) {
        log.warn(
          "getAttributesFromScimPayload",
          `Custom attribute ${customAttributeName} already exists. Might be coming from different namespace. Ignoring it.`
        );
        return;
      }

      // TODO: Support number as well as Attribute support number type
      if (
        typeof value === "string" ||
        (value instanceof Array && value.every((item) => typeof item === "string"))
      ) {
        scimUserAttributes[customAttributeName] = value;
      }
    });
  }
}

export default getAttributesFromScimPayload;
