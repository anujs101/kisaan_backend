🔐 Authentication API Service
=============================

**Base URL:** http://localhost:4000/api/auth

This service handles user registration (via Twilio OTP), password management, session handling, and secure token rotation.

📋 Authentication Flow
----------------------

1.  **Request OTP:** User submits phone number to receive a code.
    
2.  **Verify OTP:** User submits OTP; system validates session and returns Access/Refresh tokens.
    
3.  **Set Password:** Verified user sets a password (requires Access Token from step 2).
    
4.  **Login:** User logs in via Phone + Password.
    
5.  **Maintain Session:** Client rotates Refresh Tokens to keep the session alive.
    
6.  **Logout:** Client explicitly revokes the session.
    

🚀 Endpoints
------------

### 1\. Request OTP (Signup/Login)

Initiates an authentication session and triggers a Twilio SMS verification code.

*   **Endpoint:** /request-otp
    
*   **Method:** POST
    

**Request Body**

Parameter

Type

Required

Description

phone

string

Yes

The user's phone number (e.g., +91...).

purpose

string

Yes

Reason for OTP (e.g., signup, login).

metadata

object

No

Optional user details (name, email).

clientNonce

uuid

Yes

Unique client identifier for replay protection.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/request-otp \    -H "Content-Type: application/json" \    -d '{      "phone": "+919876543210",      "purpose": "signup",      "metadata": { "fullName": "Padman", "email": "padman@example.com" },      "clientNonce": "00000000-0000-0000-0000-000000000000"    }'   `

**Success Response (200 OK)**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   {    "status": "ok",    "data": {      "sessionId": "",      "ttlSeconds": 600    }  }   `

### 2\. Verify OTP

Verifies the code sent to the phone. If successful, creates or activates the user and issues tokens.

*   **Endpoint:** /verify-otp
    
*   **Method:** POST
    

**Request Body**

Parameter

Type

Required

Description

sessionId

uuid

Yes

The Session ID returned in the previous step.

otp

string

Yes

The 6-digit code received via SMS.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/verify-otp \    -H "Content-Type: application/json" \    -d '{      "sessionId": "paste-session-id-here",      "otp": "123456"    }'   `

**Success Response (200 OK)**Returns the user object (id, phone, status) and tokens (accessToken, refreshToken, expiry).

*   **Error 401:** Invalid OTP.
    
*   **Error 400:** Session expired.
    

### 3\. Set Password

Sets a password for the verified user. **Note:** This endpoint is protected and requires the Access Token received from the Verify OTP step.

*   **Endpoint:** /set-password
    
*   **Method:** POST
    
*   **Headers:** Authorization: Bearer
    

**Request Body**

Parameter

Type

Required

Description

password

string

Yes

The new strong password to set.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/set-password \    -H "Content-Type: application/json" \    -H "Authorization: Bearer " \    -d '{ "password": "MyStrongPassw0rd!" }'   `

### 4\. Login (Password)

Standard login flow for returning users using their password.

*   **Endpoint:** /login-password
    
*   **Method:** POST
    

**Request Body**

Parameter

Type

Required

Description

phone

string

Yes

Registered phone number.

password

string

Yes

User password.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/login-password \    -H "Content-Type: application/json" \    -d '{      "phone": "+919876543210",      "password": "MyStrongPassw0rd!"    }'   `

**Response Codes**

*   **200:** Success (returns user + tokens).
    
*   **403:** Phone not verified.
    
*   **401:** Invalid credentials.
    

### 5\. Refresh Token

Rotates the Refresh Token to obtain a new Access Token without re-login.

*   **Endpoint:** /refresh
    
*   **Method:** POST
    

**Request Body**

Parameter

Type

Required

Description

refreshToken

string

Yes

The valid refresh token from Login/Verify.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/refresh \    -H "Content-Type: application/json" \    -d '{ "refreshToken": "" }'   `

### 6\. Logout

Revokes the specific refresh token, effectively ending that session.

*   **Endpoint:** /logout
    
*   **Method:** POST
    

**Request Body**

Parameter

Type

Required

Description

refreshToken

string

Yes

The token to revoke.

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X POST http://localhost:4000/api/auth/logout \    -H "Content-Type: application/json" \    -d '{ "refreshToken": "" }'   `

### 7\. Get User Profile

Protected route to fetch the currently authenticated user's details.

*   **Endpoint:** /me
    
*   **Method:** GET
    
*   **Headers:** Authorization: Bearer
    

**Example Request**

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   curl -i -X GET http://localhost:4000/api/auth/me \    -H "Authorization: Bearer "   `