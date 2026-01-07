# Resumable Upload for HTTP (RUFH)

Immich server implements support for the Resumable Upload for HTTP (RUFH) protocol, enabling resumable file uploads that can recover from network interruptions. This document describes the implementation details based on testing with iOS URLSession.

## Protocol Version Support

- **iOS 17**: Uses RUFH v3 protocol
- **iOS 18 & iOS 26**: Use RUFH v6 protocol

For more information on version support, see the [RUFH implementations repository](https://github.com/tus/rufh-implementations?tab=readme-ov-file#version-support).

## Overview

While URLSession handles all protocol details automatically, we can observe the internal HTTP requests by logging on the server side. The upload flow consists of:

1. **POST request**: Always required to initiate the upload
2. **HEAD request**: Optional, sent when resuming an interrupted upload to query the current offset
3. **PATCH request**: Optional, sent to resume an interrupted upload from a specific offset

## HTTP Headers

### Content-Length and Upload-Length

- **Content-Length**: Total size of the HTTP request body
- **Upload-Length**: Total size of the file being uploaded

In resumable uploads, the client must know the total file size before starting. The client either:
- Sets `Content-Length` to the full file size when uploading in one request
- Sets `Upload-Length` to the full file size and `Content-Length` to the current chunk size when uploading in multiple chunks

### Upload-Complete and Upload-Incomplete

These headers indicate upload completion status using structured boolean values (`?1` for true, `?0` for false).

- **iOS 17**: Uses `Upload-Incomplete` header
- **iOS 18 & iOS 26**: Use `Upload-Complete` header

When uploading an entire file in one request:
- iOS 17 sets `Upload-Incomplete: ?0`
- iOS 18/26 set `Upload-Complete: ?1`

### Upload-Draft-Interop-Version

Indicates the RUFH protocol version being used. The server validates this header to ensure compatibility.

- **iOS 17**: Version 3 (minimum supported)
- **iOS 18 & iOS 26**: Version 6

### Repr-Digest

Contains a structured dictionary with the file checksum. The checksum is calculated using the xxHash64 algorithm and represented as an 8-byte ArrayBuffer. The server uses this to verify file integrity upon upload completion.

### Upload-Offset

Indicates the byte offset in the file where the next chunk should be uploaded. Used in resumable uploads to track progress. The server uses this to append new data at the correct position.

### x-immich-asset-data

Custom Immich header containing a structured dictionary with asset metadata:
- Device asset ID
- Device file path
- Device ID
- Filename
- File creation timestamp
- File modification timestamp

## HTTP Request Examples

The following examples show actual HTTP requests observed when testing with iOS URLSession.

### POST /api/upload

Initiates a new upload. This request is always sent first.

**Request Headers:**
```http
repr-digest: xxh64=:2Dw7zeWSRAI=:
x-immich-asset-data: device-asset-id="9D27DEAF-8428-4935-B6AA-41BB68583A77", device-file-path="C:\\Users\\me\\Desktop\\500gb.mp4", device-id="ios-rufh-test", filename="500gb.mp4", file-created-at="2026-01-07T03:12:43Z", file-modified-at="2026-01-07T03:12:43Z"
x-api-key: ********
content-length: 486285949
content-type: video/mp4

# iOS 18 & iOS 26
upload-draft-interop-version: 6
upload-complete: ?1

# iOS 17
upload-draft-interop-version: 3
upload-incomplete: ?0
```

**Response:**
- **104 (Interim Response)**: Returns the location URL for resuming upload
  Example: `/api/upload/97213f15-c05a-4538-9771-950bcca931c7`
- **201 (Success)**: Returns the created asset ID

### HEAD /api/upload/{asset-id}

Queries the current upload offset when resuming an interrupted upload.

**Request Headers:**
```http
x-api-key: ********

# iOS sends those which are not used by the server
repr-digest: xxh64=:2Dw7zeWSRAI=:
x-immich-asset-data: device-asset-id="9D27DEAF-8428-4935-B6AA-41BB68583A77", device-file-path="C:\\Users\\me\\Desktop\\500gb.mp4", device-id="ios-rufh-test", filename="500gb.mp4", file-created-at="2026-01-07T03:16:44Z", file-modified-at="2026-01-07T03:16:44Z"
content-type: video/mp4

# iOS 18 & iOS 26
upload-draft-interop-version: 6
content-length: 0

# iOS 17
upload-draft-interop-version: 3
```

**Response:**
- **204 (No Content)**: Returns `Upload-Offset` header with the current byte offset

### PATCH /api/upload/{asset-id}

Resumes an interrupted upload from a specific offset.

**Request Headers:**
```http
upload-offset: 87188440
x-api-key: ********
content-length: 399097509

# iOS sends those which are not used by the server
repr-digest: xxh64=:2Dw7zeWSRAI=:
x-immich-asset-data: device-asset-id="9D27DEAF-8428-4935-B6AA-41BB68583A77", device-file-path="C:\\Users\\me\\Desktop\\500gb.mp4", device-id="ios-rufh-test", filename="500gb.mp4", file-created-at="2026-01-07T03:16:44Z", file-modified-at="2026-01-07T03:16:44Z"

# iOS 18 & iOS 26
upload-draft-interop-version: 6
upload-complete: ?1
content-type: application/partial-upload

# iOS 17
upload-draft-interop-version: 3
upload-incomplete: ?0
content-type: video/mp4
```

**Response:**
- **201 (Success)**: Returns the created asset ID

### DELETE /api/upload/{asset-id}

Cancels an incomplete upload. Partially uploaded assets can be identified using the SQL query: `SELECT * FROM asset WHERE status = 'partial'`.

**Request Headers:**
```http
x-api-key: ********
```

**Response:**
- **204 (Success)**: No content

## Upload Flow

### Complete Upload (No Interruption)
1. Client sends **POST** request with complete file data
2. Server responds with **201** and asset ID

### Interrupted Upload
1. Client sends **POST** request, upload is interrupted
2. Server responds with **104** and resume location URL
3. Client sends **HEAD** request to query current offset
4. Server responds with **204** and `Upload-Offset` header
5. Client sends **PATCH** request with remaining data starting from offset
6. Server responds with **201** and asset ID


