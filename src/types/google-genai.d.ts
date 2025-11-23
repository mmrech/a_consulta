/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type definitions for Google Generative AI SDK when loaded via CDN.
 *
 * This file provides type safety for the browser-based Google GenAI SDK
 * that is loaded dynamically via script tag. These types mirror the official
 * @google/generative-ai package types but are adapted for browser window access.
 */

import type {
    GoogleGenerativeAI as NodeGoogleGenerativeAI,
    GenerativeModel as NodeGenerativeModel,
    GenerateContentResult,
    GenerateContentRequest,
    Part,
    SingleRequestOptions
} from '@google/generative-ai';

/**
 * Window extension for Google GenAI SDK loaded via CDN
 */
declare global {
    interface Window {
        google?: {
            genai?: {
                GoogleGenerativeAI: typeof NodeGoogleGenerativeAI;
            };
        };
    }
}

/**
 * Browser-accessible Google Generative AI class
 * Mirrors the Node.js GoogleGenerativeAI class but accessed via window.google.genai
 */
export type BrowserGoogleGenerativeAI = NodeGoogleGenerativeAI;

/**
 * Browser-accessible Generative Model instance
 * Returned by GoogleGenerativeAI.getGenerativeModel()
 */
export type BrowserGenerativeModel = NodeGenerativeModel;

export {};
