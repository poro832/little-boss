#!/usr/bin/env python3
"""
일회성: 비밀번호 페퍼용 KMS 키 생성 + 페퍼 암호화.
관리자 자격증명으로 1회 실행. 출력된 값을 Lambda 환경변수 PEPPER_CIPHERTEXT에 설정.

필요 환경변수:
  LAMBDA_ROLE_ARN  : 페퍼를 복호할 auth Lambda 실행 역할 ARN
  AWS_REGION       : (선택) 기본 ap-northeast-2

검증 포인트: 실행이 성공하면 kms:CreateKey/Encrypt 권한이 boundary에서 허용됨을 의미.
Lambda의 kms:Decrypt는 첫 로그인 시 검증된다.
"""
import os
import sys
import json
import base64
import secrets
import boto3

REGION = os.getenv("AWS_REGION", "ap-northeast-2")
ACCOUNT_ID = "443370697536"
LAMBDA_ROLE_ARN = os.getenv("LAMBDA_ROLE_ARN")


def main():
    if not LAMBDA_ROLE_ARN:
        sys.exit("LAMBDA_ROLE_ARN 환경변수를 설정하세요 (페퍼를 복호할 Lambda 실행 역할 ARN).")

    kms = boto3.client("kms", region_name=REGION)

    key_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AdminRoot",
                "Effect": "Allow",
                "Principal": {"AWS": f"arn:aws:iam::{ACCOUNT_ID}:root"},
                "Action": "kms:*",
                "Resource": "*",
            },
            {
                "Sid": "LambdaDecrypt",
                "Effect": "Allow",
                "Principal": {"AWS": LAMBDA_ROLE_ARN},
                "Action": "kms:Decrypt",
                "Resource": "*",
            },
        ],
    }

    key = kms.create_key(
        Description="LittleBoss password pepper (B2)",
        KeyUsage="ENCRYPT_DECRYPT",
        KeySpec="SYMMETRIC_DEFAULT",
        Policy=json.dumps(key_policy),
    )
    key_id = key["KeyMetadata"]["KeyId"]
    kms.create_alias(AliasName="alias/littleboss-password-pepper", TargetKeyId=key_id)

    pepper = secrets.token_bytes(32)
    enc = kms.encrypt(KeyId=key_id, Plaintext=pepper)
    ciphertext_b64 = base64.b64encode(enc["CiphertextBlob"]).decode("ascii")

    print("KMS KeyId :", key_id)
    print("Alias     : alias/littleboss-password-pepper")
    print()
    print("아래 값을 Lambda 환경변수 PEPPER_CIPHERTEXT 로 설정하세요 (git 커밋 금지):")
    print(ciphertext_b64)


if __name__ == "__main__":
    main()
