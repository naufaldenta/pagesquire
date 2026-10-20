<?php

namespace PageSquire\Laravel\Http\Requests;

use Illuminate\Contracts\Auth\Access\Gate;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use PageSquire\Server\ProtocolValidator;
use Throwable;

final class ChatRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->container->make(Gate::class)->allows('pagesquire.use');
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'protocolVersion' => ['required', 'in:0.1'],
            'requestId' => ['required', 'string', 'max:128'],
            'conversationId' => ['sometimes', 'string', 'max:128'],
            'snapshot' => ['required', 'array'],
            'capabilityIds' => ['present', 'array', 'max:100'],
            'capabilityIds.*' => ['required', 'string', 'max:128'],
            'message' => ['sometimes', 'string', 'max:8000'],
            'result' => ['sometimes', 'array'],
        ];
    }

    /** @return list<callable(\Illuminate\Validation\Validator): void> */
    public function after(): array
    {
        return [function (\Illuminate\Validation\Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            try {
                $raw = json_decode($this->getContent(), false, 64, JSON_THROW_ON_ERROR);
                $this->container->make(ProtocolValidator::class)->validate('chatRequest', $raw);
            } catch (Throwable) {
                $validator->errors()->add('request', 'The request does not match the PageSquire contract.');
            }
        }];
    }

    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(response()->json(['error' => ['code' => 'INVALID_PAYLOAD', 'message' => 'The request does not match the PageSquire contract.']], 422)->header('Cache-Control', 'no-store'));
    }

    protected function failedAuthorization(): void
    {
        throw new HttpResponseException(response()->json(['error' => ['code' => 'ASSISTANT_DENIED', 'message' => 'The assistant is not available for this session.']], 403)->header('Cache-Control', 'no-store'));
    }
}
