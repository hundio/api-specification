Welcome to the Hund REST API v1 documentation! If you would like to send us feedback on this API, [send us an email](mailto:support@hund.io) or [leave an issue](https://github.com/hundio/api-specification/issues) on our `api-specification` GitHub repository.

# Base URL

The base URL for the Hund API is of the following form: `https://{domain}/api/v1`, where `domain` is a status page or global dashboard domain, or the generic `api.hund.io`. Accessing the API through any of these domains will only show objects accessible from that domain.

## Status Page Domain

When using the domain of a particular status page, only objects viewable from that status page will be available from the API on that domain. This includes `Group`s, `Component`s, and their `Issue`s, as well as `Watchdog`s used by those `Component`s.

Only API keys with sufficient permissions for the given status page may use this API.

## Global Dashboard Domain

When using the domain of the global dashboard, all objects across your entire account are visible, up to any Privacy Control the API key's user is subject to.

**Note:** since a shared `Component` will belong to multiple `Group`s across your status pages, the `group` field of `Component` does not exist in this context, and cannot be set. Thus, a specific status page API must be used to change the structure of that status page's `Group`s.

Only API keys with sufficient global permissions may use this API.

## Generic Domain (api.hund.io)

When using the generic `api.hund.io` domain, either of the above described APIs are accessible, depending on the value of the header `Hund-Context`. The value of this header should be either be a `StatusPage` ObjectId, or the string `global`. The API key section of the dashboard will list the valid `StatusPage` IDs, in case you would prefer to access the API via the generic domain. By default, the `global` context is assumed.

**Note:** if your account uses a single status page, we recommend using your specific status page domain instead of this generic one for simplicity.

As above, whether a particular context is accessible from this domain depends on the permissions granted to the given API key.

# Authentication

Hund uses API keys to facilitate authentication. These keys can be given in a couple different formats, described below. API keys are created from the dashboard, and each is linked to the specific user that created it. API keys can be given lesser or equivalent permissions to the linked user.

<!-- ReDoc-Inject: <SecurityDefinitions /> -->

# Internationalization (I18n)

Some fields in this API can be displayed differently on your status page based on the language requested by the user. These fields are marked with type `i18n-string`, and as such can be either a `string` or `object` (with [IETF BCP 47 language tag](https://tools.ietf.org/rfc/bcp/bcp47.html) keys and string values; e.g. `{"en": "Hello!", "de": "Hallo!", "pt-BR": "Olá!"}`), depending on the value of the `Accept-Language` header.

Given an `Accept-Language` header value of `*`, values of type `i18n-string` will be the full object of translations. If a translation does not exist for the requested language, English (`en`) is used as a fallback.

Similarly, when sending values of type `i18n-string` in `POST` or `PUT` requests, the `Accept-Language` header will dictate the particular language given strings are in. Again, to set the entire object of translations at once requires setting `Accept-Language: *`. Without this header, English (`en`) is assumed to be the language of any given `i18n-string`s.

# Errors

Our API returns traditional HTTP response codes to describe the status of a response. Thus, `2xx` codes denote success, `4xx` codes denote an error on the part of the user, and `5xx` codes denote a backend server error (these are rare, and monitored internally).

User errors (`4xx`) will return a [`vnd.error`](https://github.com/blongden/vnd.error) object, which contains a more descriptive error message, as well as the request ID, **which should be supplied in any support requests concerning particular requests you have made**.

If a resource returns a specific success/error code for some reason, it will be documented within that particular resource. There are some general error codes, however, that you may encounter within any resource:

| Code | Description |
|---|---|
| 401 (Unauthorized) | A valid API key was not given. |
| 403 (Forbidden) | The given API key does not have permission to access the requested resource. |
| 404 (Not Found) | The requested HTTP verb/path combination does not exist. |
| 429 (Too Many Requests) | You are making too many requests too quickly. Try using some form of backoff (Fibonacci or exponential are good choices) if you must make large batches of requests. |
| 5xx (Server Errors) | Hund has encountered some form of backend error. These errors are uncommon, and are automatically reported to our staff. |

# Request IDs

Every request made against the Hund API is logged with a unique request ID, which is returned in the response header `Request-Id`. **When making a support request concerning a specific API request, this ID should be supplied for fastest possible resolution.**

# Expandable Fields

Certain ID fields returned in API objects may be expanded to the full referenced object in the response by requesting expansion as part of the request query parameters. These fields are marked in this documentation as "expandable: `true`."

To request expansion for an expandable field, a dot-delimited path to that field must be given in the `expand` array query parameter (i.e. one or more `expand[]` query parameters).

For example, to expand the `watchdog` field of `GET /components/{id}` would require the query string `expand[]=watchdog`. If we wanted to accomplish the same expansion for the `GET /components` index, we must use the path `data.watchdog` instead, since the index returns a PagedArray, whose `data` field contains the actual objects on the given page.

As a more complex example, say we are requesting `GET /issues`, the Issue index; and, we want to expand each Watchdog and Group for each Component in each Issue. Respectively, the two paths required are thusly `data.components.data.watchdog` and `data.components.data.group`, which gives us the query parameter fragment `expand[]=data.components.data.watchdog&expand[]=data.components.data.group`.

**Note:** An expansion path may only have up to _four_ segments, to limit excessive expansion depth.

# Hypermedia (HAL) Support

To facilitate discoverability, as well as compatibility with the existing hypermedia API software ecosystem, the Hund API supports [HAL](https://tools.ietf.org/html/draft-kelly-json-hal-08), a hypermedia API standard. Both API and HTML UI links are supplied by the various endpoints of this API.

## HAL Directory

The root of the API (`GET https://{domain}/api/v1`) can be requested to retrieve a HAL directory with links to the various endpoints of the API. The Hund API should work with most HAL-compliant hypermedia clients (e.g. [hyperclient](https://github.com/codegram/hyperclient) for Ruby).

## Link Relations

The various links returned by an endpoint are documented under each object's `_links` property. The location of this HAL Links object depends on the variant of HAL requested (see [HAL Variants](#section/Hypermedia-(HAL)-Support/HAL-Variants) below for more details).

The link relations of an endpoint follow a predictable naming scheme as follows:

* **`self`**: Reflexive URL pointing to the API resource that will return the exact document containing this URL.
* **`create`**: Create a new record via `POST`. **Usually, this is not given**, as the URL (as per REST) should be equivalent to `POST` on a collection `self`.
* **`update`**: Update a specific item, or all items in a collection (if supported) via `PUT`. **Usually, this is not given**, as the URL (as per REST) should be equivalent to `PUT` on an item/collection `self`.
* **`delete`**: Deletes a specific item via `DELETE`. **Usually, this is not given**, as the URL (as per REST) should be equivalent to `DELETE` on item `self`.
* **`search`**: Perform a search on a collection.
* **`beginning`**: The first set of records in a `PagedArray`.
* **`prev`**: The previous set of records in a `PagedArray`.
* **`next`**: The next set of records in a `PagedArray`.
* **`end`**: The last set of records in a `PagedArray`.

In addition to the above, we use a special prefix described below for "actions" against a resource:

* **`action:*`**: A `PUT` action that can be taken against the resource (e.g. `action:cancel` for a scheduled `Issue`).

We also use a couple suffixes on link relations, used with the above relations, to denote human-friendly (i.e. HTML) links:

* **`*-form`**: A human-friendly form (often for `create`/`update`) of a link relation (e.g. for `Issue`s, `create-form` would point to the dashboard form for creating a new `Issue`).
* **`*-view`**: A human-friendly view of a link relation (e.g. for an `Issue`, `self-view` would point to that `Issue` on your status page).

## HAL Variants

The Hund API supports a few (_unofficial_) variants for rendering HAL links:

* **`standard`**: Both `_links` and embedded record properties are stored under nested `_embedded` keys in the root object. This is "vanilla" HAL, and will have the **best support** with HAL-compliant hypermedia clients.
* **`links-only`**: Only `_links` from embedded records will appear under nested `_embedded` keys in the root object. This leaves data in its usual place as described by this API documentation. For example, for a root `Group` object, there exists a `components` field, which under this variant would contain the actual `Component` objects in a `PagedArray`. However, any `_links` property associated with each member of `components` would be found from the root at `_embedded.components._embedded.data._links` instead of within each `Component` object. This is the usual location for `_links` in HAL, though normally the data would go with it as well. Compatibility with hypermedia clients is **not guaranteed**.
* **`compact`**: Objects will not embed data nor `_links` under `_embedded` in the root object. Instead, `_links` is always a direct property of any object, regardless of nesting. For example, for a root `Group` object, there exists a `components` field, which under this variant, each `Component` in `components.data` would contain its own `_links` property. This is a highly compacted variant of HAL, which is more reminiscent of non-HAL APIs. Compatibility with hypermedia clients is **not guaranteed** nor expected.

The **default** variant returned by the API is `links-only`. To request the API to return HAL in one of these variants, simply supply an `Accept` header with value `application/hal+json;variant={variant}`, where `{variant}` is one of the variants listed above.

### Variant Examples

#### `standard`

```json
{
  "id": "5e16ee938fbb652ab878caa9",
  "type": "group",
  "name": "Regions",
  "created_at": 1543958163,
  "updated_at": 1543958564,
  "description": "My **description**",
  "description_html": "<p>My <strong>description</strong></p>",
  "collapsed": false,
  "position": 3,
  "_links": {
    "self": { "href": "..." },
    "update-form": { "href": "..." }
  },
  "_embedded": {
    "components": {
      "type": "paged_array",
      "total_count": 2,
      "has_more": false,
      "_links": {
        "self": { "href": "..." },
        "create": { "href": "..." },
        "next": { "href": "..." },
        "prev": { "href": "..." },
        "beginning": { "href": "..." },
        "end": { "href": "..." }
      },
      "_embedded": {
        "data": [
          {
            "id": "5e16ee938fbb652ab878cabb",
            "type": "component",
            "group": "5e16ee938fbb652ab878caa9",
            "name": "Singapore",
            "created_at": 1543958163,
            "updated_at": 1543958164,
            "last_event_at": 1580352001,
            "exclude_from_global_uptime": false,
            "exclude_from_global_history": false,
            "description": "My **description**",
            "description_html": "<p>My <strong>description</strong></p>",
            "percent_uptime": 100,
            "watchdog": "5e06ee938fbb652ab878cab9",
            "_links": {
              "self": { "href": "..." },
              "self-view": { "href": "..." },
              "update-form": { "href": "..." }
            }
          },
          {
            "id": "5e16ee938fbb652ab878cacc",
            "type": "component",
            "group": "5e16ee938fbb652ab878caa9",
            "name": "Amsterdam",
            "created_at": 1543958100,
            "updated_at": 1543958169,
            "last_event_at": 1580353042,
            "exclude_from_global_uptime": false,
            "exclude_from_global_history": false,
            "description": "My **description**",
            "description_html": "<p>My <strong>description</strong></p>",
            "percent_uptime": 100,
            "watchdog": "5e16ee938fbb652ab878cac9",
            "_links": {
              "self": { "href": "..." },
              "self-view": { "href": "..." },
              "update-form": { "href": "..." }
            }
          }
        ]
      }
    }
  }
}
```

#### `links-only`

```json
{
  "id": "5e16ee938fbb652ab878caa9",
  "type": "group",
  "name": "Regions",
  "created_at": 1543958163,
  "updated_at": 1543958564,
  "description": "My **description**",
  "description_html": "<p>My <strong>description</strong></p>",
  "collapsed": false,
  "position": 3,
  "components": {
    "type": "paged_array",
    "total_count": 2,
    "has_more": false,
    "data": [
      {
        "id": "5e16ee938fbb652ab878cabb",
        "type": "component",
        "group": "5e16ee938fbb652ab878caa9",
        "name": "Singapore",
        "created_at": 1543958163,
        "updated_at": 1543958164,
        "last_event_at": 1580352001,
        "exclude_from_global_uptime": false,
        "exclude_from_global_history": false,
        "description": "My **description**",
        "description_html": "<p>My <strong>description</strong></p>",
        "percent_uptime": 100,
        "watchdog": "5e06ee938fbb652ab878cab9"
      },
      {
        "id": "5e16ee938fbb652ab878cacc",
        "type": "component",
        "group": "5e16ee938fbb652ab878caa9",
        "name": "Amsterdam",
        "created_at": 1543958100,
        "updated_at": 1543958169,
        "last_event_at": 1580353042,
        "exclude_from_global_uptime": false,
        "exclude_from_global_history": false,
        "description": "My **description**",
        "description_html": "<p>My <strong>description</strong></p>",
        "percent_uptime": 100,
        "watchdog": "5e16ee938fbb652ab878cac9"
      }
    ]
  },
  "_links": {
    "self": { "href": "..." },
    "update-form": { "href": "..." }
  },
  "_embedded": {
    "components": {
      "_links": {
        "self": { "href": "..." },
        "create": { "href": "..." },
        "next": { "href": "..." },
        "prev": { "href": "..." },
        "beginning": { "href": "..." },
        "end": { "href": "..." }
      },
      "_embedded": {
        "data": [
          {
            "_links": {
              "self": { "href": "..." },
              "self-view": { "href": "..." },
              "update-form": { "href": "..." }
            }
          },
          {
            "_links": {
              "self": { "href": "..." },
              "self-view": { "href": "..." },
              "update-form": { "href": "..." }
            }
          }
        ]
      }
    }
  }
}
```

#### `compact`

```json
{
  "id": "5e16ee938fbb652ab878caa9",
  "type": "group",
  "name": "Regions",
  "created_at": 1543958163,
  "updated_at": 1543958564,
  "description": "My **description**",
  "description_html": "<p>My <strong>description</strong></p>",
  "collapsed": false,
  "position": 3,
  "components": {
    "type": "paged_array",
    "total_count": 2,
    "has_more": false,
    "data": [
      {
        "id": "5e16ee938fbb652ab878cabb",
        "type": "component",
        "group": "5e16ee938fbb652ab878caa9",
        "name": "Singapore",
        "created_at": 1543958163,
        "updated_at": 1543958164,
        "last_event_at": 1580352001,
        "exclude_from_global_uptime": false,
        "exclude_from_global_history": false,
        "description": "My **description**",
        "description_html": "<p>My <strong>description</strong></p>",
        "percent_uptime": 100,
        "watchdog": "5e06ee938fbb652ab878cab9",
        "_links": {
          "self": { "href": "..." },
          "self-view": { "href": "..." },
          "update-form": { "href": "..." }
        }
      },
      {
        "id": "5e16ee938fbb652ab878cacc",
        "type": "component",
        "group": "5e16ee938fbb652ab878caa9",
        "name": "Amsterdam",
        "created_at": 1543958100,
        "updated_at": 1543958169,
        "last_event_at": 1580353042,
        "exclude_from_global_uptime": false,
        "exclude_from_global_history": false,
        "description": "My **description**",
        "description_html": "<p>My <strong>description</strong></p>",
        "percent_uptime": 100,
        "watchdog": "5e16ee938fbb652ab878cac9",
        "_links": {
          "self": { "href": "..." },
          "self-view": { "href": "..." },
          "update-form": { "href": "..." }
        }
      }
    ],
    "_links": {
      "self": { "href": "..." },
      "create": { "href": "..." },
      "next": { "href": "..." },
      "prev": { "href": "..." },
      "beginning": { "href": "..." },
      "end": { "href": "..." }
    }
  },
  "_links": {
    "self": { "href": "..." },
    "update-form": { "href": "..." }
  }
}
```

# Versioning

Our API supports dated versioning. A dated version is cut whenever backwards incompatible changes are made to the API. This way, usage of the same dated version across time will never break your integrations.

The default API version to use can be configured and upgraded from the dashboard.

To make an API call against a specific version, use the `Hund-Version` header like so: `Hund-Version: 2021-09-01`.

API request URLs also contain a major version (currently `v1`). This major version will ideally never change, but a new version may be cut if it is deemed absolutely necessary.
